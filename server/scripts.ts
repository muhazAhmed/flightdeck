/**
 * What a project can be told to run.
 *
 * Read from `package.json`, plus which package manager the repository actually uses — running `npm run dev` in a
 * pnpm workspace works often enough to be dangerous and fails confusingly when it does not, so the lockfile is
 * consulted rather than assumed.
 *
 * Nothing here executes anything. The command is handed to the terminal, which types it exactly as you would.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectScripts, ScriptEntry } from '@shared/types';

/** A package.json larger than this is not a package.json. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Which script means "start this project".
 *
 * In order, because a repository with both `dev` and `start` almost always means `dev` for local work — `start`
 * tends to be the production entry point.
 */
const RUN_ORDER = ['dev', 'start', 'develop', 'serve'];

/**
 * The package manager, from whichever lockfile is present.
 *
 * Checked most-specific first: a repository migrating to pnpm often still carries a stale `package-lock.json`, and
 * the newer lockfile is the one being maintained.
 */
function detectManager(root: string): ProjectScripts['manager'] {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** How that manager spells "run this script". Only yarn omits the word. */
export function runCommand(manager: ProjectScripts['manager'], script: string): string {
  return manager === 'yarn' ? `yarn ${script}` : `${manager} run ${script}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read a project's scripts.
 *
 * A missing or unreadable `package.json` is not an error — plenty of repositories are not Node projects, and the UI
 * simply offers nothing for them.
 */
export function scriptsFor(root: string): ProjectScripts {
  const manager = detectManager(root);
  const empty: ProjectScripts = { manager, scripts: [], suggested: null };

  const path = join(root, 'package.json');
  if (!existsSync(path)) return empty;

  let parsed: unknown;
  try {
    if (statSync(path).size > MAX_BYTES) return empty;
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A malformed package.json is the project's problem, not something to fail a request over.
    return empty;
  }

  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return empty;

  const scripts: ScriptEntry[] = Object.entries(parsed.scripts)
    .filter(([name, command]) => typeof command === 'string' && name.length > 0)
    .map(([name, command]) => ({ name, command: String(command), run: runCommand(manager, name) }));

  const suggested = RUN_ORDER.find((name) => scripts.some((script) => script.name === name)) ?? null;
  return { manager, scripts, suggested };
}
