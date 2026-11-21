/**
 * What a workflow task is allowed to do, turned into CLI flags.
 *
 * Pure apart from reading a project's notes and scripts: no process is started here (that is server/agent.ts),
 * and nothing is decided at run time that could not be read off the returned argv.
 *
 * THE PERMISSION MODEL, which is the part worth understanding:
 *
 * A headless run cannot ask. This CLI has no approval channel (API.md), so a tool call that would prompt is
 * denied, full stop. A task that must run tests therefore needs its commands allowed *up front* — and the
 * choice is between allowing exactly those and bypassing permissions altogether. This allows exactly those:
 * the project's own check commands, by prefix, and nothing else that executes.
 *
 * The deny list beneath it is belt and braces. With nothing allowed, `git commit` is already refused; the
 * explicit rules matter only if someone later adds a broad allow rule, and they keep CLAUDE.md rule 6 true
 * then too. They are prefix matches on the command text — a guard against the ordinary case, not a sandbox.
 * The diff the human reviews is still the real control.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '@shared/types';
import type { AgentRole, ProjectWorkflowConfig, WorkflowSettings } from '@shared/workflow';
import { knowledgeDir } from './platform.js';
import { scriptsFor } from './scripts.js';

/**
 * The CLI's two shell tools.
 *
 * VERIFIED BY RUNNING IT: on Windows the tool is `PowerShell`, not `Bash`, and a rule written for one does
 * not match the other — an allow list of `Bash(npm test:*)` alone left `npm test` denied. Every command rule
 * is written for both, so the same configuration works on either platform.
 */
const SHELL_TOOLS = ['Bash', 'PowerShell'];

/** Git verbs that move history, branches or uncommitted work. The agent edits files; the human does these. */
const DENIED_GIT = [
  'commit',
  'push',
  'pull',
  'checkout',
  'switch',
  'branch',
  'merge',
  'rebase',
  'reset',
  'restore',
  'clean',
  'stash',
  'tag',
  'cherry-pick',
  'revert',
  'worktree'
];

/**
 * Tools that would take a task outside "one session, one working tree, while you watch".
 *
 * Worktrees and anything scheduled or remote are what the first decision in DECISIONS.md ruled out, and the
 * reversal that allows delegation keeps ruling them out.
 */
const DENIED_TOOLS = [
  'EnterWorktree',
  'ExitWorktree',
  'CronCreate',
  'CronDelete',
  'ScheduleWakeup',
  'RemoteTrigger',
  'Workflow',
  'PushNotification'
];

/** Script names that check a project rather than run it. `dev` and `start` never end, so they are not here. */
const CHECK_SCRIPT = /^(test|tests|lint|typecheck|type-check|types|tsc|check|build|e2e|format:check)([:.-].*)?$/;

/**
 * Variants that share a check's name but are something else.
 *
 * Seen on a real project: `test:watch` matched as a check, and a watcher never exits — an agent that ran it
 * would wait forever. `build:deploy` is the other half: nothing here may publish anything, and a script is
 * not safe to allow just because its name starts with `build`.
 */
const NOT_A_CHECK = /watch|dev|serve|start|deploy|publish|release|upload|push/i;

export const NOTES_FILE = 'NOTES.md';

export function notesPath(projectId: string): string {
  return join(knowledgeDir(projectId), NOTES_FILE);
}

export function readNotes(projectId: string): string {
  try {
    return readFileSync(notesPath(projectId), 'utf8');
  } catch {
    // No notes yet is the normal state of a project that has never had a task.
    return '';
  }
}

export function writeNotes(projectId: string, text: string): void {
  mkdirSync(knowledgeDir(projectId), { recursive: true });
  writeFileSync(notesPath(projectId), text, 'utf8');
}

/** The project's own check commands, spelled for its package manager. Empty for a non-Node repository. */
export function detectCommands(root: string): string[] {
  const { manager, scripts } = scriptsFor(root);
  const commands = scripts
    .filter((script) => CHECK_SCRIPT.test(script.name) && !NOT_A_CHECK.test(script.name))
    .map((script) => script.run);
  // `npm test` is how people actually type it, and it is a different command line from `npm run test`.
  if (scripts.some((script) => script.name === 'test')) commands.push(`${manager} test`);
  return [...new Set(commands)];
}

export function configFor(project: Project): ProjectWorkflowConfig {
  return {
    commands: project.workflowCommands ?? null,
    detected: detectCommands(project.path),
    knowledge: readNotes(project.id)
  };
}

/**
 * Is this safe to put inside a permission rule and hand to the CLI as an argument?
 *
 * A leading dash would be read as a flag — `--allowedTools` takes a list, so the next dash-prefixed value
 * ends it and becomes an option of its own. Parentheses and newlines would break out of the `Tool(...)` rule
 * the command is wrapped in.
 */
export function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && !trimmed.startsWith('-') && !/[()\r\n]/.test(trimmed);
}

export function isSafeRule(rule: string): boolean {
  const trimmed = rule.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && !trimmed.startsWith('-') && !/[\r\n]/.test(trimmed);
}

/** The CLI's short model names, which is what an agent definition takes. Unknown or empty means "inherit". */
function modelAlias(model: string): string | undefined {
  for (const alias of ['opus', 'sonnet', 'haiku']) {
    if (model.includes(alias)) return alias;
  }
  return undefined;
}

/** The `--agents` payload: one definition per enabled role. */
export function agentsJson(roles: AgentRole[]): string {
  const out: Record<string, { description: string; prompt: string; model?: string }> = {};
  for (const role of roles) {
    if (!role.enabled) continue;
    const model = modelAlias(role.model);
    out[role.id] = { description: role.description, prompt: role.prompt, ...(model ? { model } : {}) };
  }
  return JSON.stringify(out);
}

/** The lead's standing instructions plus the facts about this project it cannot discover for itself. */
export function leadSystemPrompt(settings: WorkflowSettings, project: Project, commands: string[]): string {
  const roles = settings.roles.filter((role) => role.enabled);
  const lines = [
    settings.leadPrompt.trim(),
    '',
    `Project: ${project.name}`,
    `Project notes file: ${notesPath(project.id)}`,
    commands.length > 0
      ? `Commands you may run without approval (anything else that executes will be denied — there is nobody to approve it): ${commands.join(', ')}`
      : 'No check commands are configured for this project, so shell commands that execute anything will be denied. Say so in the report rather than claiming a check ran.',
    roles.length > 0
      ? `Specialists you may delegate to: ${roles.map((role) => `${role.id} (${role.name})`).join(', ')}.`
      : 'No specialists are configured. Do the whole task yourself.'
  ];
  return lines.join('\n');
}

/**
 * Everything a task run adds to the ordinary chat argv.
 *
 * Returned as argv, never as a command string: the prompt holds newlines and quotes, the notes path may hold
 * spaces, and agent.ts spawns without a shell so each element arrives intact.
 */
export function taskArgs(settings: WorkflowSettings, project: Project): string[] {
  const commands = (project.workflowCommands ?? detectCommands(project.path)).filter(isSafeCommand);
  const allow = [
    ...commands.flatMap((command) => SHELL_TOOLS.map((tool) => `${tool}(${command.trim()}:*)`)),
    ...settings.allowedTools.filter(isSafeRule).map((rule) => rule.trim())
  ];
  const deny = [
    ...DENIED_GIT.flatMap((verb) => SHELL_TOOLS.map((tool) => `${tool}(git ${verb}:*)`)),
    ...DENIED_TOOLS
  ];

  // The notes folder has to exist before the CLI is told about it, and it must be writable by the lead.
  const notes = knowledgeDir(project.id);
  if (!existsSync(notes)) mkdirSync(notes, { recursive: true });

  const args = ['--add-dir', notes, '--append-system-prompt', leadSystemPrompt(settings, project, commands)];
  const agents = agentsJson(settings.roles);
  if (agents !== '{}') args.push('--agents', agents);
  if (allow.length > 0) args.push('--allowedTools', ...allow);
  args.push('--disallowedTools', ...deny);
  return args;
}
