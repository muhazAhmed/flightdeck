/**
 * Which shells this machine actually has.
 *
 * Detection rather than a hardcoded list: the point of a profile picker is that it offers what is
 * installed here, and "Git Bash" is at a different path on every machine — on this one it is
 * `D:\tools\Git\bin\bash.exe` on a machine where git was installed off the system drive,
 * nowhere near Program Files.
 *
 * Everything is probed on disk or asked of the tool itself. Nothing is assumed, and a probe that
 * fails simply omits that profile rather than offering something that cannot start.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { ShellProfile } from '@shared/types';
import { isWindows } from './platform.js';

/** Detection walks the filesystem and shells out to `wsl`; neither changes while the server runs. */
let cache: ShellProfile[] | null = null;

function onPath(name: string): string | null {
  for (const entry of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(entry, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Git Bash sits beside the git binary, but `git` resolves to either `<root>/cmd/git.exe` or
 * `<root>/mingw64/bin/git.exe` depending on how it was installed — so walk up from whichever we
 * find and look for `bin/bash.exe`.
 */
function gitBash(): string | null {
  const git = onPath('git.exe');
  if (!git) return null;
  const candidates = [
    resolve(dirname(git), '..', 'bin', 'bash.exe'), // <root>/cmd/git.exe
    resolve(dirname(git), '..', '..', 'bin', 'bash.exe') // <root>/mingw64/bin/git.exe
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/**
 * Installed WSL distributions.
 *
 * `wsl --list --quiet` writes **UTF-16LE**; decoding it as UTF-8 yields "U\0b\0u\0..." and a list of
 * garbage names that then fail to launch. Reading as a buffer and decoding explicitly is the whole
 * trick.
 */
function wslDistros(): string[] {
  const wsl = onPath('wsl.exe');
  if (!wsl) return [];
  try {
    const raw = execFileSync(wsl, ['--list', '--quiet'], { encoding: 'buffer', timeout: 5000 });
    return raw
      .toString('utf16le')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      // Docker's helper distros are not shells anyone wants a prompt in.
      .filter((name) => !/^docker-desktop/.test(name));
  } catch {
    // WSL installed but not provisioned exits non-zero; that is "no distros", not an error.
    return [];
  }
}

function detectWindows(): ShellProfile[] {
  const profiles: ShellProfile[] = [];

  const pwsh = onPath('pwsh.exe') ?? ['C:\\Program Files\\PowerShell\\7\\pwsh.exe'].find((p) => existsSync(p));
  if (pwsh) profiles.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh, args: ['-NoLogo'] });

  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const powershell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (existsSync(powershell)) {
    profiles.push({ id: 'powershell', label: 'Windows PowerShell', path: powershell, args: ['-NoLogo'] });
  }

  const cmd = process.env.COMSPEC ?? join(root, 'System32', 'cmd.exe');
  if (existsSync(cmd)) profiles.push({ id: 'cmd', label: 'Command Prompt', path: cmd, args: [] });

  const bash = gitBash();
  // `--login -i` is what makes Git Bash behave like the shortcut does; without it the prompt and
  // PATH are not what the user expects.
  if (bash) profiles.push({ id: 'gitbash', label: 'Git Bash', path: bash, args: ['--login', '-i'] });

  const wsl = onPath('wsl.exe');
  if (wsl) {
    for (const distro of wslDistros()) {
      profiles.push({
        id: `wsl:${distro}`,
        label: `WSL · ${distro}`,
        path: wsl,
        args: ['-d', distro],
        // `wsl.exe` is handed the project's Windows path as its cwd and translates it itself, so the
        // prompt starts under /mnt. Left to WSL rather than translated here: only it knows how the
        // distro is mounted.
        note: 'Runs through wsl.exe — the project path appears under /mnt'
      });
    }
  }

  return profiles;
}

function detectPosix(): ShellProfile[] {
  const profiles: ShellProfile[] = [];
  const seen = new Set<string>();

  const add = (id: string, label: string, path: string) => {
    if (!existsSync(path) || seen.has(path)) return;
    seen.add(path);
    profiles.push({ id, label, path, args: [] });
  };

  // The login shell first: it is what the user chose for themselves.
  const login = process.env.SHELL;
  if (login) add('login', `${login.split('/').pop() ?? login} (login shell)`, login);

  add('zsh', 'zsh', '/bin/zsh');
  add('bash', 'bash', '/bin/bash');
  add('fish', 'fish', '/usr/bin/fish');
  add('sh', 'sh', '/bin/sh');
  return profiles;
}

export function detect(): ShellProfile[] {
  if (cache) return cache;
  cache = isWindows ? detectWindows() : detectPosix();
  return cache;
}

export function find(id: string | undefined): ShellProfile | null {
  if (!id) return null;
  return detect().find((profile) => profile.id === id) ?? null;
}

/**
 * The profile used when nothing is chosen: an explicit `FLIGHTDECK_SHELL`, else the first detected
 * profile. Detection order is deliberate — PowerShell 7 before 5.1 before cmd — so the default is
 * the best thing installed rather than whatever the OS reports.
 */
export function defaultProfile(): ShellProfile {
  const override = process.env.FLIGHTDECK_SHELL?.trim();
  if (override) return { id: 'custom', label: 'Custom (FLIGHTDECK_SHELL)', path: override, args: [] };

  const detected = detect();
  const first = detected[0];
  if (first) return first;

  // Nothing detected at all: fall back to something the platform almost certainly has, so a terminal
  // still opens rather than the feature disappearing.
  return isWindows
    ? { id: 'cmd', label: 'Command Prompt', path: process.env.COMSPEC ?? 'cmd.exe', args: [] }
    : { id: 'sh', label: 'sh', path: '/bin/sh', args: [] };
}

export function resetCache(): void {
  cache = null;
}
