/**
 * Running `git` directly.
 *
 * WHY NOT simple-git FOR THIS: simple-git ships a "block unsafe operations" plugin that
 * refuses to run whenever the environment it is handed contains `GIT_ASKPASS`,
 * `GIT_EDITOR`, `SSH_ASKPASS` and friends — any variable that could hand git an arbitrary
 * program to execute. That guard is reasonable for untrusted input, but our environment is
 * whatever shell launched the server, and editors like VS Code set `GIT_ASKPASS` as a
 * matter of course. The result was push failing with
 * `Use of "GIT_ASKPASS" is not permitted without enabling allowUnsafeAskPass`, and the
 * opt-out flags are undocumented in the published typings.
 *
 * So the remote and config operations spawn `git` themselves: argv array, no shell, and an
 * environment we construct explicitly. simple-git is still used for reads and staging,
 * where it saves real parsing work and is never handed a custom env.
 */
import { spawn } from 'node:child_process';

/** Generous enough for a fetch over a slow link; short enough that a wedged credential
 *  helper does not hold a request open forever. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Variables that let git run another program. Stripped for two independent reasons: they
 * are what simple-git objects to, and an askpass helper belonging to a code editor cannot
 * usefully prompt on behalf of a background server anyway.
 *
 * Git's own credential helpers (`credential.helper`, Windows Credential Manager, the macOS
 * keychain) are configured in git config rather than the environment, so they keep working
 * — which is what makes a real push possible without a prompt.
 */
const UNSAFE_ENV = [
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_PAGER',
  'GIT_EXTERNAL_DIFF',
  'GIT_PROXY_COMMAND',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'EDITOR',
  'VISUAL'
];

export interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || UNSAFE_ENV.includes(key)) continue;
    env[key] = value;
  }
  // Nothing can answer a terminal prompt here, so fail immediately and readably instead of
  // blocking until the timeout.
  env.GIT_TERMINAL_PROMPT = '0';
  // Stable, parseable output regardless of the user's locale.
  env.LC_ALL = 'C';
  return env;
}

/**
 * Run one git command. Never throws: a non-zero exit is data, because git uses exit codes
 * for ordinary outcomes (nothing to commit, no differences) as well as for failures.
 */
export function runGit(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env: childEnv(), shell: false, windowsHide: true });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: GitResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        ok: false,
        code: null,
        stdout,
        stderr: stderr.trim() || `git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)}s`
      });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, code: null, stdout, stderr: err.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, code, stdout, stderr });
    });
  });
}

/** The message worth showing a human: git puts the useful part on stderr, but falls back to
 *  stdout for a few commands (push writes its summary there in some versions). */
export function messageOf(result: GitResult): string {
  return result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.code}`;
}
