/**
 * Locating the `claude` binary.
 *
 * WHY THIS IS NOT JUST `spawn('claude')`: on Windows, npm installs a CLI as a `claude.cmd`
 * batch shim, and `CreateProcess` cannot execute a `.cmd` — the spawn fails with ENOENT
 * even though `claude` runs perfectly in a shell. The usual workaround is to spawn through
 * `cmd.exe /c`, which drags a shell parser into the middle of every launch; that is the
 * class of bug that eats an afternoon (paths with spaces, quoting, CR/LF truncation).
 *
 * Instead we resolve what the shim actually points at and spawn that directly, so there is
 * no shell anywhere in the path. Resolution order:
 *
 *   1. `CLAUDE_BIN` — explicit override, for anyone with a custom install.
 *   2. A real executable on PATH (`claude.exe` on Windows, `claude` elsewhere).
 *   3. On Windows, the `.cmd` / `.ps1` shim, decoded to the `.exe` or `.js` it wraps.
 *   4. `cmd.exe /d /s /c claude` as a last resort. Safe here only because our argv is
 *      flag-shaped — the prompt travels over stdin, never on the command line.
 *
 * The result is cached: this touches the filesystem and nothing about it changes while the
 * server is up.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { isWindows } from './platform.js';

export interface ResolvedCli {
  command: string;
  /** Arguments that must precede ours (a script path, or the cmd.exe preamble). */
  prefixArgs: string[];
  /** How it was found — surfaced in errors so a failure is diagnosable. */
  source: string;
}

let cached: ResolvedCli | null = null;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function searchPath(names: string[]): string | null {
  const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const entry of entries) {
    for (const name of names) {
      const candidate = join(entry, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Pull the real target out of a Windows shim. Both the `.cmd` and `.ps1` forms contain a
 * quoted path to the thing they actually run, relative to the shim's own directory via
 * `%dp0%` / `%~dp0` / `$PSScriptRoot`.
 */
function decodeShim(shimPath: string): ResolvedCli | null {
  let text: string;
  try {
    text = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }

  const here = dirname(shimPath);
  const match = text.match(/"([^"]*\.(?:exe|js))"/i);
  if (!match?.[1]) return null;

  const target = resolve(
    match[1]
      .replace(/%~?dp0%?/gi, `${here}\\`)
      .replace(/\$PSScriptRoot/gi, here)
      .replace(/[\\/]{2,}/g, '\\')
  );
  if (!isFile(target)) return null;

  // A .js target is a Node script and needs an interpreter; an .exe runs itself.
  return target.toLowerCase().endsWith('.js')
    ? { command: process.execPath, prefixArgs: [target], source: `${shimPath} -> node ${target}` }
    : { command: target, prefixArgs: [], source: `${shimPath} -> ${target}` };
}

export function resolveCli(): ResolvedCli {
  if (cached) return cached;

  const override = process.env.CLAUDE_BIN?.trim();
  if (override) {
    const path = isAbsolute(override) ? override : resolve(override);
    cached = { command: isFile(path) ? path : override, prefixArgs: [], source: 'CLAUDE_BIN' };
    return cached;
  }

  const direct = searchPath(isWindows ? ['claude.exe'] : ['claude']);
  if (direct) {
    cached = { command: direct, prefixArgs: [], source: direct };
    return cached;
  }

  if (isWindows) {
    const shim = searchPath(['claude.cmd', 'claude.ps1']);
    if (shim) {
      const decoded = decodeShim(shim);
      if (decoded) {
        cached = decoded;
        return cached;
      }
    }
    cached = {
      command: process.env.COMSPEC ?? 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'claude'],
      source: 'cmd.exe fallback'
    };
    return cached;
  }

  // POSIX with nothing on PATH: let spawn fail with a clear ENOENT rather than guessing.
  cached = { command: 'claude', prefixArgs: [], source: 'PATH (unresolved)' };
  return cached;
}

/** True when the resolver found something that exists on disk. Used to fail with a useful
 *  message before a run starts, instead of an ENOENT the user has to interpret. */
export function cliIsAvailable(): boolean {
  const { command, prefixArgs } = resolveCli();
  if (prefixArgs.includes('claude')) return existsSync(command); // cmd.exe fallback
  return isFile(command);
}

export function resetCliCache(): void {
  cached = null;
}
