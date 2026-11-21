import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
  type AccentName,
  type ConfirmLevel,
  type Density,
  type PermissionMode,
  type Settings,
  type ThemeName
} from '@shared/types';
import type { WorkflowSettings } from '@shared/workflow';
import * as state from '../state.js';
import { isSafeRule } from '../workflow.js';
import { badRequest } from '../errors.js';

const THEMES: ThemeName[] = ['dark', 'light'];
const ACCENTS: AccentName[] = ['cyan', 'violet', 'blue', 'green', 'amber', 'pink', 'red'];
const DENSITIES: Density[] = ['comfortable', 'compact'];
const CONFIRM_LEVELS: ConfirmLevel[] = ['all', 'destructive'];
const PERMISSION_MODES: PermissionMode[] = ['acceptEdits', 'plan', 'bypassPermissions'];
/** Terminal type below 9px is unreadable and above 24px fits nothing; both ends are guards, not taste. */
const FONT_SIZE_RANGE = { min: 9, max: 24 };
/** A cap of 1 or 2 turns cannot finish anything, and past 200 it is not a cap. */
const MAX_TURNS_RANGE = { min: 0, max: 200 };

/**
 * A model id must be one this build offers, or the empty string.
 *
 * Not a free-text field: a typo reaches the CLI as `--model claude-opus-6`, which fails per run with
 * an error that looks like a Flight Deck bug rather than a bad setting.
 */
function isKnownModel(value: string): boolean {
  return MODEL_OPTIONS.some((option) => option.id === value);
}

/**
 * Preferences live beside projects in `state.json` rather than in browser storage: the server is
 * the only thing that persists across a reload, a second tab, or a machine restart, and a setting
 * that silently differs per tab is worse than no setting.
 *
 * Every field is validated against its allowed values. An unknown accent name would otherwise reach
 * the DOM as a `data-accent` attribute that matches no CSS rule, leaving the app looking broken with
 * nothing to explain it.
 */
/**
 * Why a workflow patch is refused, or null when it is fine.
 *
 * Checked field by field because every one of these ends up on a command line: a role id is a key the CLI
 * delegates by, a prompt is an argument, an allow rule is an argument in a list a stray dash would end. The
 * length caps keep the whole argv well inside what Windows will accept for one process.
 */
function workflowProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'workflow must be an object.';
  const workflow = value as Partial<WorkflowSettings>;

  if (typeof workflow.leadPrompt !== 'string' || workflow.leadPrompt.length > 8000) {
    return 'The lead prompt must be text of at most 8000 characters.';
  }
  if (!Array.isArray(workflow.roles) || workflow.roles.length > 8) return 'There can be at most 8 roles.';

  const seen = new Set<string>();
  for (const role of workflow.roles) {
    if (typeof role !== 'object' || role === null) return 'Each role must be an object.';
    if (typeof role.id !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(role.id)) {
      return 'A role id must be 2 to 31 lowercase letters, digits or dashes, starting with a letter.';
    }
    if (seen.has(role.id)) return `Two roles share the id "${role.id}".`;
    seen.add(role.id);
    if (typeof role.name !== 'string' || !role.name.trim() || role.name.length > 60) {
      return `Role "${role.id}" needs a name of at most 60 characters.`;
    }
    if (typeof role.description !== 'string' || !role.description.trim() || role.description.length > 600) {
      return `Role "${role.id}" needs a description of at most 600 characters — the lead reads it to decide when to delegate.`;
    }
    if (typeof role.prompt !== 'string' || !role.prompt.trim() || role.prompt.length > 6000) {
      return `Role "${role.id}" needs a prompt of at most 6000 characters.`;
    }
    if (typeof role.model !== 'string' || !isKnownModel(role.model)) return `Role "${role.id}" has an unknown model.`;
    if (typeof role.enabled !== 'boolean') return `Role "${role.id}": enabled must be true or false.`;
  }

  if (!Array.isArray(workflow.allowedTools) || workflow.allowedTools.length > 40) {
    return 'There can be at most 40 allowed tool rules.';
  }
  const bad = workflow.allowedTools.find((rule) => typeof rule !== 'string' || !isSafeRule(rule));
  if (bad !== undefined) {
    return `"${String(bad)}" is not a usable rule: one line, at most 200 characters, not starting with a dash.`;
  }
  return null;
}

function current(): Settings {
  return { ...DEFAULT_SETTINGS, ...(state.read().settings ?? {}) };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (): Promise<Settings> => current());

  app.patch<{ Body: Partial<Settings> }>('/api/settings', async (req, reply) => {
    const patch = req.body ?? {};

    if (patch.theme !== undefined && !THEMES.includes(patch.theme)) {
      return badRequest(reply, `Unknown theme: ${patch.theme}`);
    }
    if (patch.accent !== undefined && !ACCENTS.includes(patch.accent)) {
      return badRequest(reply, `Unknown accent: ${patch.accent}`);
    }
    if (patch.density !== undefined && !DENSITIES.includes(patch.density)) {
      return badRequest(reply, `Unknown density: ${patch.density}`);
    }
    if (patch.confirmLevel !== undefined && !CONFIRM_LEVELS.includes(patch.confirmLevel)) {
      return badRequest(reply, `Unknown confirm level: ${patch.confirmLevel}`);
    }
    if (patch.restoreLastProject !== undefined && typeof patch.restoreLastProject !== 'boolean') {
      return badRequest(reply, 'restoreLastProject must be true or false.');
    }
    if (patch.terminalShell !== undefined && typeof patch.terminalShell !== 'string') {
      return badRequest(reply, 'terminalShell must be a string.');
    }
    if (
      patch.terminalFontSize !== undefined &&
      (typeof patch.terminalFontSize !== 'number' ||
        !Number.isFinite(patch.terminalFontSize) ||
        patch.terminalFontSize < FONT_SIZE_RANGE.min ||
        patch.terminalFontSize > FONT_SIZE_RANGE.max)
    ) {
      return badRequest(
        reply,
        `Terminal font size must be between ${FONT_SIZE_RANGE.min} and ${FONT_SIZE_RANGE.max}.`
      );
    }
    if (patch.terminalCursorBlink !== undefined && typeof patch.terminalCursorBlink !== 'boolean') {
      return badRequest(reply, 'terminalCursorBlink must be true or false.');
    }
    if (patch.defaultModel !== undefined && !isKnownModel(patch.defaultModel)) {
      return badRequest(reply, `Unknown model: ${patch.defaultModel}`);
    }
    if (patch.draftModel !== undefined && !isKnownModel(patch.draftModel)) {
      return badRequest(reply, `Unknown model: ${patch.draftModel}`);
    }
    if (patch.defaultPermissionMode !== undefined && !PERMISSION_MODES.includes(patch.defaultPermissionMode)) {
      return badRequest(reply, `Unknown permission mode: ${patch.defaultPermissionMode}`);
    }
    if (
      patch.maxTurns !== undefined &&
      (!Number.isInteger(patch.maxTurns) ||
        patch.maxTurns < MAX_TURNS_RANGE.min ||
        patch.maxTurns > MAX_TURNS_RANGE.max)
    ) {
      return badRequest(
        reply,
        `Turn cap must be a whole number between ${MAX_TURNS_RANGE.min} (no cap) and ${MAX_TURNS_RANGE.max}.`
      );
    }
    if (patch.commitSignoff !== undefined && typeof patch.commitSignoff !== 'boolean') {
      return badRequest(reply, 'commitSignoff must be true or false.');
    }
    if (patch.checkForUpdates !== undefined && typeof patch.checkForUpdates !== 'boolean') {
      return badRequest(reply, 'checkForUpdates must be true or false.');
    }
    if (patch.workflow !== undefined) {
      const problem = workflowProblem(patch.workflow);
      if (problem) return badRequest(reply, problem);
    }
    // A stale last-project id is harmless — the client ignores one that no longer exists — so it is
    // accepted without checking the project still exists.
    if (patch.lastProjectId !== undefined && patch.lastProjectId !== null && typeof patch.lastProjectId !== 'string') {
      return badRequest(reply, 'lastProjectId must be a string or null.');
    }

    return state.update((s) => {
      s.settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}), ...patch };
      return s.settings;
    });
  });

  /** Back to defaults, keeping `lastProjectId` — resetting appearance should not also forget which
   *  project you were working in. */
  app.post('/api/settings/reset', async (): Promise<Settings> =>
    state.update((s) => {
      s.settings = { ...DEFAULT_SETTINGS, lastProjectId: s.settings?.lastProjectId ?? null };
      return s.settings;
    })
  );
}
