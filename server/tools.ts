/**
 * External command-line tools this machine may or may not have.
 *
 * WHY DETECTION AND NOT INSTALLATION. Some features need a tool Flight Deck does not ship: reviewing a pull
 * request needs the GitHub CLI. The tempting version of this is a `postinstall` hook that offers to install
 * it — and that is a trap. `npm install` runs non-interactively under `npm ci`, in CI and in Docker, so a
 * prompt there hangs a build with no explanation; "install gh" is a different command on every platform and
 * often a privileged one; and even a successful install leaves the user at `gh auth login`, which is a
 * browser flow. So nothing here installs anything. It reports what is present, and hands the exact command
 * for THIS machine to the UI, which types it into the terminal the user can already see.
 *
 * Spawning lives in `agent.ts` and `pty.ts` by rule, with detection as the standing exception — `shells.ts`
 * asks `wsl` what distros exist for the same reason this asks `gh` what version it is.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolId, ToolStatus } from '@shared/types';
import { isWindows } from './platform.js';

const run = promisify(execFile);

/** A probe that hangs must not hang the page. `gh auth status` validates a token over the network. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * The line ending that terminates a token on stdin.
 *
 * From its code point, for the same reason `ENTER` is written that way in the terminal hook: a literal newline
 * inside a string is invisible, and the first tool to normalise line endings turns it into CRLF or eats it.
 */
const NEWLINE = String.fromCharCode(10);

/**
 * Detection is cached, and every path that matters can force a re-probe.
 *
 * Cached because `gh auth status` is a network round trip and the PR page would otherwise pay it on every
 * render. Refreshable because the whole point of the "try again" button is that the user just installed
 * something — a cache with no way past it would report "not found" forever and read as a broken feature.
 */
let cache: { tools: ToolStatus[]; checkedAt: string } | null = null;

/**
 * Package managers, per operating system, in the order we would rather use them.
 *
 * PER OS RATHER THAN ONE LIST, and that is a bug fix rather than tidying. The first version probed a single
 * global list, which let a Windows machine with MSYS2's `pacman` on PATH and no winget be told
 * `sudo pacman -S github-cli` — a command with no `sudo` to run it, in a package set that does not have that
 * package. A manager being *present* does not mean it is the right one to be told about here.
 *
 * Native first, then the cross-platform outsider: on Fedora `dnf install gh` is the answer even on a machine
 * that also has Homebrew, because it is the one whose updates arrive with the system's.
 *
 * `apt` is deliberately absent. The official Debian/Ubuntu route adds a keyring and an apt source before it
 * can install anything, and a privileged three-command sequence typed into a terminal by a button is not
 * something anyone should accept on trust — those machines get the documentation link instead. The same goes
 * for anything needing a tap, a PPA or a third-party repository first.
 */
export interface ManagerSpec {
  id: Manager;
  /** The whole command, for this manager, on this OS. Package names differ: Arch calls it `github-cli`. */
  ghInstall: string;
}

export type Manager = 'winget' | 'choco' | 'scoop' | 'brew' | 'port' | 'dnf' | 'pacman' | 'zypper' | 'apk';

/** winget ships with Windows 11, so it is first; the other two are what people install when it is missing. */
const WINDOWS_MANAGERS: ManagerSpec[] = [
  { id: 'winget', ghInstall: 'winget install --id GitHub.cli --source winget' },
  { id: 'choco', ghInstall: 'choco install gh' },
  { id: 'scoop', ghInstall: 'scoop install gh' }
];

const MACOS_MANAGERS: ManagerSpec[] = [
  { id: 'brew', ghInstall: 'brew install gh' },
  { id: 'port', ghInstall: 'sudo port install gh' }
];

const LINUX_MANAGERS: ManagerSpec[] = [
  { id: 'dnf', ghInstall: 'sudo dnf install gh' },
  // Arch names the package after the project, not the binary.
  { id: 'pacman', ghInstall: 'sudo pacman -S github-cli' },
  { id: 'zypper', ghInstall: 'sudo zypper install gh' },
  { id: 'apk', ghInstall: 'sudo apk add github-cli' },
  // Homebrew on Linux runs unprivileged in its own prefix, which is why it sits below the system's own.
  { id: 'brew', ghInstall: 'brew install gh' }
];

/**
 * Which managers are even worth probing here.
 *
 * An unrecognised platform (BSD, and whatever comes next) gets an empty list rather than a guess: no command
 * is a better answer than a wrong one, and the documentation link covers every platform.
 */
export function managersFor(platform: NodeJS.Platform = process.platform): ManagerSpec[] {
  switch (platform) {
    case 'win32':
      return WINDOWS_MANAGERS;
    case 'darwin':
      return MACOS_MANAGERS;
    case 'linux':
      return LINUX_MANAGERS;
    default:
      return [];
  }
}

export interface Probe {
  /** The command ran, whatever it then said. */
  found: boolean;
  /** It ran and exited 0. */
  ok: boolean;
  stdout: string;
  /** The tool's own words when it ran and failed. Shown verbatim — never "something went wrong". */
  detail: string | null;
}

/**
 * Ask a tool about itself, by name, and let the OS resolve it.
 *
 * NOT `existsSync` over `PATH`, which is what this did first and which is wrong on Windows: `winget` lives at
 * `%LOCALAPPDATA%/Microsoft/WindowsApps/winget.exe`, an **app execution alias** — a zero-length reparse point
 * that `stat` cannot resolve, so the check returned false for a command that runs perfectly. Measured on this
 * machine: `existsSync` false, `statSync` ENOENT, and `execFile('winget', ['--version'])` printing a version.
 * Anything Store-installed has the same shape, so a filesystem probe silently under-reports.
 *
 * Argv array, never a command string: paths have spaces on every platform.
 */
export async function probe(command: string, args: string[], timeoutMs = PROBE_TIMEOUT_MS): Promise<Probe> {
  try {
    const { stdout } = await run(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      // A pull request list is larger than the default 1 MB pipe buffer allows for on a busy repository, and
      // exceeding it kills the child with ENOBUFS rather than truncating.
      maxBuffer: 16 * 1024 * 1024
    });
    return { found: true, ok: true, stdout, detail: null };
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String(err.code) : '';
    // ENOENT is "no such command"; a non-zero exit is an answer — `gh auth status` exits 1 when nobody is
    // logged in, which is a state to report rather than a failure to hide.
    const found = code !== 'ENOENT';
    const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr) : '';
    const detail = (stderr || (err instanceof Error ? err.message : String(err))).trim();
    return { found, ok: false, stdout: '', detail: found ? detail || null : null };
  }
}

/**
 * Whether a command exists at all, without running it.
 *
 * SEPARATE FROM `probe` BECAUSE OF `.cmd`. Node refuses to spawn a `.cmd` or `.bat` without a shell — it
 * fails with ENOENT — and scoop installs itself as `scoop.cmd`. Measured: `execFile('npm', ['--version'])`
 * gives `spawn npm ENOENT` on this machine, for an npm that plainly works. So a package manager is checked
 * for existence with `where`/`which`, which finds shims and app execution aliases both.
 *
 * Existence is the right question for a manager: the command it produces is typed into a shell, where a
 * `.cmd` runs perfectly. A tool we intend to run ourselves — `gh` — still has to answer `probe`.
 */
export async function exists(command: string): Promise<boolean> {
  return (await probe(isWindows ? 'where' : 'which', [command])).ok;
}

/**
 * The first manager this machine has *of the ones that make sense here*, or null.
 *
 * Only this platform's list is checked, which is what stops a Windows machine carrying MSYS2 from being handed
 * a `sudo pacman` command. Short-circuited, so the usual cost is one spawn: on Windows 11 `winget` answers
 * first.
 */
export async function firstManager(platform: NodeJS.Platform = process.platform): Promise<ManagerSpec | null> {
  for (const manager of managersFor(platform)) {
    if (await exists(manager.id)) return manager;
  }
  return null;
}

/**
 * The command to offer, or null when nothing recognised is here.
 *
 * Only ever a command whose manager actually answered — offering `brew install gh` on a machine without brew
 * is worse than offering nothing, because it turns "install this" into "debug this".
 */
export function ghInstallCommand(manager: ManagerSpec | null): string | null {
  return manager?.ghInstall ?? null;
}

/**
 * `gh version 2.63.2 (2024-12-19)` → `2.63.2`.
 *
 * The whole first line is kept when the shape is not what we expected, rather than showing nothing: an
 * unparsed version string still tells the user which build answered.
 */
export function parseGhVersion(stdout: string): string | null {
  const line = stdout.split(/\r?\n/)[0]?.trim();
  if (!line) return null;
  return /^gh version (\S+)/.exec(line)?.[1] ?? line;
}

/** `✓ Logged in to github.com account octocat (keyring)` → `octocat`. Cosmetic; null is fine. */
export function parseGhAccount(report: string): string | null {
  return /account (\S+)/.exec(report)?.[1] ?? null;
}

/** Where it is, best effort. Null is an acceptable answer for a command that runs — an alias has no real path. */
async function locate(command: string): Promise<string | null> {
  const result = await probe(isWindows ? 'where' : 'which', [command]);
  if (!result.ok) return null;
  return result.stdout.split(/\r?\n/)[0]?.trim() || null;
}

async function detectGh(): Promise<ToolStatus> {
  const base = {
    id: 'gh' as const,
    label: 'GitHub CLI',
    command: 'gh',
    purpose: 'Reading pull requests and their diffs. Nothing else in Flight Deck needs it.',
    docsUrl: 'https://github.com/cli/cli#installation',
    authCommand: 'gh auth login',
    /*
     * Where to make a token, with the scopes gh asks for already ticked.
     *
     * `repo`, `read:org` and `gist` are `gh auth login --with-token`'s stated minimum. Prefilling them is the
     * difference between one click and a page of checkboxes you have to be told about.
     */
    tokenUrl:
      'https://github.com/settings/tokens/new?scopes=repo,read:org,gist&description=Flight%20Deck'
  };

  const version = await probe('gh', ['--version']);
  if (!version.found) {
    // The install command is only worked out when it is needed, which keeps the common case (gh present) to
    // the two probes below rather than also hunting for a package manager nobody is going to use.
    const manager = await firstManager();
    return {
      ...base,
      installed: false,
      version: null,
      path: null,
      authenticated: null,
      account: null,
      installCommand: ghInstallCommand(manager),
      installManager: manager?.id ?? null,
      detail: null
    };
  }

  /*
   * Installed and logged in are two different states that fail differently.
   *
   * `gh` present but unauthenticated fails mid-request as a permission error, not as a missing command — so
   * showing "install the GitHub CLI" to someone who already has it is the tell of a check that only asked one
   * question. `gh auth status` exits non-zero when nobody is logged in and writes its report to stderr.
   */
  const auth = await probe('gh', ['auth', 'status']);
  const report = auth.ok ? auth.stdout : (auth.detail ?? '');
  return {
    ...base,
    installed: true,
    version: parseGhVersion(version.stdout),
    path: await locate('gh'),
    authenticated: auth.ok,
    account: parseGhAccount(report),
    installCommand: null,
    installManager: null,
    detail: auth.ok ? null : auth.detail
  };
}

/**
 * Hand a personal access token to `gh` and let it store the thing.
 *
 * WHY THIS EXISTS, reported from use: driving `gh auth login`'s device-code flow through the embedded terminal
 * is fragile in a way that cannot be fixed by presenting it better. The code has to be copied out of a terminal
 * (where `Ctrl+C` is SIGINT, not copy), the CLI has to stay alive through a browser round trip it does not own,
 * and an interrupted attempt looks identical to a failed one — authorise in the browser after the CLI has died
 * and nothing happens, with nothing to say why. One field and one button has none of those failure modes.
 *
 * THE TOKEN IS NEVER OURS. It goes to gh on stdin and gh puts it in the system credential store; Flight Deck
 * does not write it to `state.json`, does not log it, and does not keep it in memory past this call. Stdin
 * rather than argv deliberately — argv is visible to anything that can list processes.
 */
export async function ghLoginWithToken(token: string): Promise<{ ok: boolean; detail: string | null }> {
  const trimmed = token.trim();
  // A pasted token is one line. Anything else is a paste accident, and passing it on would have gh report a
  // confusing error about a token that was never sent.
  if (trimmed === '' || /\s/.test(trimmed)) {
    return { ok: false, detail: 'That does not look like a token: it must be a single line with no spaces.' };
  }
  if (trimmed.length > 512) {
    return { ok: false, detail: 'That is too long to be a token.' };
  }

  return new Promise((resolve) => {
    const child = spawn('gh', ['auth', 'login', '--with-token'], { windowsHide: true });
    let stderr = '';
    let settled = false;
    const finish = (result: { ok: boolean; detail: string | null }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, detail: 'gh did not finish in time.' });
    }, PROBE_TIMEOUT_MS);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, detail: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // The cache now describes a machine that no longer exists, whichever way this went.
      cache = null;
      // gh's own words on failure — a bad token, a network problem, a host that refused.
      finish({ ok: code === 0, detail: code === 0 ? null : stderr.trim() || `gh exited with code ${code}` });
    });

    // `--with-token` reads one line from stdin, so the newline is what tells it the token is complete.
    child.stdin.end(trimmed + NEWLINE);
  });
}

export async function read(options: { refresh?: boolean } = {}): Promise<{ tools: ToolStatus[]; checkedAt: string }> {
  if (cache && !options.refresh) return cache;
  const tools = [await detectGh()];
  cache = { tools, checkedAt: new Date().toISOString() };
  return cache;
}

/** Which tools a feature needs. Kept here so a page names a capability rather than a binary. */
export const REQUIRED_FOR: Record<'pr', ToolId[]> = {
  pr: ['gh']
};
