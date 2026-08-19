/**
 * Every platform-specific and machine-specific decision, in one file.
 *
 * WHY THIS EXISTS: Flight Deck is developed on Windows but is intended to be portable
 * (and open-sourceable) with no code changes. Nothing anywhere else in the codebase may
 * assume a drive letter, a shell, or a directory that happens to exist on the author's
 * machine. If you find yourself typing a path literal outside this file, put it here
 * instead — or better, in state, where the user owns it.
 */
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const isWindows = platform() === 'win32';

/** Where `state.json` lives. Cross-platform by construction. */
export function stateDir(): string {
  return join(homedir(), '.flightdeck');
}

export function statePath(): string {
  return join(stateDir(), 'state.json');
}

/**
 * Where the add-project picker opens when the user has never browsed before.
 *
 * Deliberately the home directory and nothing cleverer. There is NO default projects
 * root: guessing one would be wrong for everyone but the author, and a wrong guess in a
 * file picker is worse than an obvious starting point. After the first add, the last
 * browsed directory is remembered in state.
 */
export function defaultBrowseDir(): string {
  return homedir();
}

/**
 * How Claude Code encodes a working directory into a transcript folder name, e.g.
 * `E:\muhaz\flightdeck` becomes `E--muhaz-flightdeck`. Used to locate a session's
 * transcript for history replay (Phase 2).
 *
 * Derived from the observed format rather than documented, so treat a miss as "no
 * history available" and never as an error.
 */
export function transcriptDirFor(cwd: string): string {
  // EVERY separator becomes its own dash. The drive prefix in a Windows path is two
  // characters (colon then backslash) and therefore two dashes:
  // `E:\muhaz\flightdeck` -> `E--muhaz-flightdeck`. Collapsing runs (a `+` in the pattern)
  // yields `E-muhaz-flightdeck`, a directory that exists nowhere, and history replay then
  // silently finds nothing at all.
  const encoded = cwd.replace(/[\\/:]/g, '-');
  return join(homedir(), '.claude', 'projects', encoded);
}
