/**
 * Every platform-specific and machine-specific decision, in one file.
 *
 * WHY THIS EXISTS: Flight Deck is developed on Windows but is intended to be portable
 * (and open-sourceable) with no code changes. Nothing anywhere else in the codebase may
 * assume a drive letter, a shell, or a directory that happens to exist on the author's
 * machine. If you find yourself typing a path literal outside this file, put it here
 * instead — or better, in state, where the user owns it.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const isWindows = platform() === 'win32';

/** Where `state.json` lives. Cross-platform by construction. */
export function stateDir(): string {
  return join(homedir(), '.flightdeck');
}

export function statePath(): string {
  return join(stateDir(), 'state.json');
}

/**
 * Flight Deck's own directory — the clone or fork this copy is running from.
 *
 * Derived from this module's location rather than `process.cwd()`, which is wherever the user happened to
 * start the server. Used only to ask git whether the install is behind its own remote; if someone runs a
 * copy that is not a git repository, that check reports "not a repository" instead of failing.
 */
export function appRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

/**
 * Where pasted and dropped files are kept.
 *
 * Outside every repository on purpose — a screenshot is not part of anyone's source tree. That choice has
 * a consequence the agent has to be told about: this path is not under the project's working directory, so
 * the CLI will refuse to read from it unless it is passed as an additional allowed directory. See
 * `--add-dir` in server/agent.ts.
 */
export function attachmentsDir(): string {
  return join(stateDir(), 'attachments');
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

/** Where the CLI keeps every project's transcripts. Scanned when an encoded name misses. */
export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * How Claude Code encodes a working directory into a transcript folder name.
 *
 * EVERY character that is not a letter or a digit becomes its own dash, including separators. So
 * A Windows path of `C:` then `\repos\my_app` becomes `C--repos-my-app`: the colon and the backslash are two
 * characters and therefore two dashes, and the underscore is a third.
 *
 * THE BUG THIS FIXES, reported from use: open a chat, refresh the page, and the conversation was gone. This
 * replaced only `[\/:]`, so a path containing an underscore — extremely ordinary — resolved to a directory
 * that does not exist. The transcript was sitting on disk the whole time under a name one character different.
 * Collapsing runs (a `+` in the pattern) is the other way to get this wrong: it yields `C-repos-app`, which
 * also exists nowhere.
 *
 * Derived from observation rather than documentation, which is exactly why `findTranscript` in transcript.ts
 * falls back to a scan: the encoding can change again, and a session id is unambiguous.
 */
export function transcriptEncode(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function transcriptDirFor(cwd: string): string {
  return join(projectsRoot(), transcriptEncode(cwd));
}

/**
 * The same directory, found on a filesystem that cares about case.
 *
 * Windows resolves `E--repo` to a directory named `e--repo` for free, so the encoded name is enough there —
 * and the CLI does record both, depending on whether the shell handed it `E:\` or `e:\`. On Linux and macOS it
 * is not enough, so a miss falls back to a case-insensitive match among the project directories.
 *
 * Returns the encoded path when nothing matches: a caller wants somewhere to report as empty, not a null.
 */
export function resolveTranscriptDir(cwd: string): string {
  const encoded = transcriptDirFor(cwd);
  if (existsSync(encoded)) return encoded;
  const wanted = transcriptEncode(cwd).toLowerCase();
  try {
    for (const entry of readdirSync(projectsRoot(), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase() === wanted) return join(projectsRoot(), entry.name);
    }
  } catch {
    // No projects directory: the CLI has never run on this machine, which is not an error.
  }
  return encoded;
}
