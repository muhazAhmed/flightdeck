/**
 * One-shot, non-interactive `claude` calls for the app's own small jobs — currently drafting a
 * commit message.
 *
 * Separate from `agent.ts` because the shape is different in every way that matters: no session
 * to resume, no streaming, a single turn, and no ability to touch the repository. Reusing the
 * agent path would drag session management and permission modes into something that only needs
 * a string back.
 *
 * The write-capable tools are denied outright. The prompt already contains everything needed to
 * answer, so a tool call here would mean the model is doing something nobody asked for.
 *
 * THE PROMPT GOES ON STDIN, NEVER ON ARGV. A commit-message prompt carries a diff, and Windows
 * caps a command line at ~32,767 characters — a real staged diff sails past that and `spawn`
 * fails with ENAMETOOLONG before the model is ever reached. `claude -p` with no prompt argument
 * reads the prompt from stdin, which has no such limit.
 */
import { spawn } from 'node:child_process';
import { cliIsAvailable, resolveCli } from './cli.js';

const TIMEOUT_MS = 120_000;

/** Tools an internal helper must never have. `--disallowedTools` takes tool names or patterns. */
const DENIED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Task'];

/**
 * Which model actually answered.
 *
 * There is no top-level `model` field in the CLI's JSON result — the model appears as a KEY of
 * `modelUsage` (e.g. `"claude-opus-5[1m]"`). Reading a non-existent field silently reported
 * "unknown" for every draft, which is the kind of small lie that makes a UI untrustworthy.
 */
function modelOf(record: Record<string, unknown>): string | null {
  const usage = record.modelUsage;
  if (typeof usage !== 'object' || usage === null) return null;
  const [first] = Object.keys(usage);
  return first ?? null;
}

export interface OneShotResult {
  ok: boolean;
  text: string;
  /** Notional API-equivalent cost the CLI reports. Not money billed on a subscription. */
  costUsd: number | null;
  model: string | null;
  error?: string;
}

/**
 * Ask once, get text back.
 *
 * `cwd` matters even though nothing is read from disk: the CLI resolves project settings and
 * `CLAUDE.md` relative to it, so running inside the project keeps a repository's own conventions
 * in play when drafting a message about it.
 */
/**
 * The argv for a one-shot call. Exported for testing: the prompt must never appear here (see the
 * ENAMETOOLONG note above), and that is exactly the kind of thing a test should hold in place.
 */
export function buildOneShotArgs(prefixArgs: string[], model?: string): string[] {
  const args = [
    ...prefixArgs,
    // No prompt argument: it arrives on stdin.
    '-p',
    '--output-format',
    'json',
    // One turn: this is a question with a text answer, not a task.
    '--max-turns',
    '1',
    '--disallowedTools',
    ...DENIED_TOOLS
  ];
  if (model) args.push('--model', model);
  return args;
}

export function ask(cwd: string, prompt: string, model?: string): Promise<OneShotResult> {
  if (!cliIsAvailable()) {
    return Promise.resolve({
      ok: false,
      text: '',
      costUsd: null,
      model: null,
      error: `Could not find the claude CLI (looked at: ${resolveCli().source}).`
    });
  }

  const cli = resolveCli();
  const args = buildOneShotArgs(cli.prefixArgs, model);

  return new Promise((resolve) => {
    const child = spawn(cli.command, args, { cwd, shell: false, windowsHide: true });

    // Closing stdin is what tells the CLI the prompt is complete.
    child.stdin.on('error', () => {
      /* the child may exit before the write lands; the close handler reports the real reason */
    });
    child.stdin.end(prompt, 'utf8');

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: OneShotResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, text: '', costUsd: null, model: null, error: 'The request timed out.' });
    }, TIMEOUT_MS);

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
      finish({ ok: false, text: '', costUsd: null, model: null, error: err.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish({
          ok: false,
          text: '',
          costUsd: null,
          model: null,
          error: stderr.trim() || `claude exited with code ${code}.`
        });
        return;
      }

      try {
        const parsed: unknown = JSON.parse(stdout);
        const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
        // A refusal or an internal error still exits 0 with `is_error` set — check it rather
        // than trusting the exit code alone.
        if (record.is_error === true) {
          finish({
            ok: false,
            text: '',
            costUsd: null,
            model: null,
            error: typeof record.result === 'string' ? record.result : 'The model returned an error.'
          });
          return;
        }
        finish({
          ok: true,
          text: typeof record.result === 'string' ? record.result.trim() : '',
          costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null,
          model: modelOf(record)
        });
      } catch {
        finish({
          ok: false,
          text: '',
          costUsd: null,
          model: null,
          error: 'Could not parse the CLI response.'
        });
      }
    });
  });
}
