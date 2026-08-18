import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_SETTINGS,
  type AccentName,
  type ConfirmLevel,
  type Density,
  type Settings,
  type ThemeName
} from '@shared/types';
import * as state from '../state.js';
import { badRequest } from '../errors.js';

const THEMES: ThemeName[] = ['dark', 'light'];
const ACCENTS: AccentName[] = ['cyan', 'violet', 'blue', 'green', 'amber', 'pink', 'red'];
const DENSITIES: Density[] = ['comfortable', 'compact'];
const CONFIRM_LEVELS: ConfirmLevel[] = ['all', 'destructive'];

/**
 * Preferences live beside projects in `state.json` rather than in browser storage: the server is
 * the only thing that persists across a reload, a second tab, or a machine restart, and a setting
 * that silently differs per tab is worse than no setting.
 *
 * Every field is validated against its allowed values. An unknown accent name would otherwise reach
 * the DOM as a `data-accent` attribute that matches no CSS rule, leaving the app looking broken with
 * nothing to explain it.
 */
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
