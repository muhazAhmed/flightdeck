/**
 * Spawning and supervising `claude` processes — one per active chat.
 *
 * The only module in the codebase that starts an agent. Everything it knows about the
 * CLI's surface is documented in API.md §1, and the event shapes it relies on were
 * captured from a real run (`docs/stream-sample.jsonl`).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Chat, Project, UiEvent } from '@shared/types';
import { cliIsAvailable, resolveCli } from './cli.js';
import { LineBuffer, coalesceText, translateLine } from './stream.js';

/** How long text deltas are pooled before being written to the client. Long enough to
 *  collapse a burst of single-character deltas, short enough to feel live. */
const TEXT_FLUSH_MS = 50;

/** Grace between SIGTERM and SIGKILL when a run is aborted. */
const KILL_GRACE_MS = 2000;

interface Run {
  child: ChildProcessWithoutNullStreams;
  /** Resolves when the process has exited and all events have been emitted. */
  finished: Promise<void>;
}

const runs = new Map<string, Run>();

export function isRunning(chatId: string): boolean {
  return runs.has(chatId);
}

export function runningChats(): string[] {
  return [...runs.keys()];
}

/**
 * Stop a chat's process. SIGTERM first so the CLI can close its session cleanly, then
 * SIGKILL if it is still alive — an orphaned agent keeps working invisibly and holds
 * the session, which is worse than an unclean exit.
 */
export async function abort(chatId: string): Promise<boolean> {
  const run = runs.get(chatId);
  if (!run) return false;
  run.child.kill('SIGTERM');
  const killed = await Promise.race([
    run.finished.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), KILL_GRACE_MS))
  ]);
  if (!killed) run.child.kill('SIGKILL');
  return true;
}

export function buildArgs(chat: Chat, resume: boolean, maxTurns = 0): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    // The prompt is delivered as a JSON message on stdin, which requires this.
    '--input-format',
    'stream-json',
    '--include-partial-messages',
    // stream-json refuses to emit without it; not a debugging flag despite the name.
    '--verbose',
    '--permission-mode',
    chat.permissionMode
  ];
  // Absent means the CLI's own default; passing an empty string would be an error.
  if (chat.model) args.push('--model', chat.model);
  // A cap of 0 means no cap, so the flag is omitted entirely — `--max-turns 0` would end every run
  // before it started.
  if (maxTurns > 0) args.push('--max-turns', String(maxTurns));
  // A session id can only be *claimed* once. After the first turn the same conversation
  // has to be re-entered with --resume, or the CLI rejects the id as already in use.
  args.push(resume ? '--resume' : '--session-id', chat.sessionId);
  return args;
}

/**
 * Send one prompt and stream everything the agent does back through `onEvent`.
 *
 * Resolves when the process exits. Never rejects: a spawn failure or a non-zero exit is
 * reported as an `error` event so the caller has exactly one path for failures, and the
 * client always learns why.
 */
export async function send(
  project: Project,
  chat: Chat,
  prompt: string,
  resume: boolean,
  onEvent: (event: UiEvent) => void,
  /** Hard cap on turns; 0 means none. Passed in rather than read here — this module spawns, it does
   *  not consult state. */
  maxTurns = 0
): Promise<void> {
  if (runs.has(chat.id)) {
    onEvent({ type: 'error', message: 'This chat is already running. Stop it before sending again.' });
    return;
  }

  if (!cliIsAvailable()) {
    onEvent({
      type: 'error',
      message: 'Could not find the claude CLI.',
      detail: `Install Claude Code, or set CLAUDE_BIN to its executable. Looked at: ${resolveCli().source}`
    });
    return;
  }

  const cli = resolveCli();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(cli.command, [...cli.prefixArgs, ...buildArgs(chat, resume, maxTurns)], {
      cwd: project.path,
      // argv array, never a shell string: paths hold spaces and backslashes. The Windows
      // .cmd shim is resolved to its real target in cli.ts, so no shell is needed here.
      shell: false,
      windowsHide: true
    });
  } catch (err) {
    onEvent({
      type: 'error',
      message: 'Could not start the claude CLI.',
      detail: `${err instanceof Error ? err.message : String(err)} (resolved via ${cli.source})`
    });
    return;
  }

  const buffer = new LineBuffer();
  let pending: UiEvent[] = [];
  let stderr = '';

  const flush = () => {
    if (pending.length === 0) return;
    for (const event of coalesceText(pending)) onEvent(event);
    pending = [];
  };
  const timer = setInterval(flush, TEXT_FLUSH_MS);

  const finished = new Promise<void>((resolve) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) pending.push(...translateLine(line));
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      pending.push({
        type: 'error',
        message: 'The claude process failed to start.',
        detail: err.message
      });
    });

    child.on('close', (code) => {
      for (const line of buffer.flush()) pending.push(...translateLine(line));
      // A non-zero exit without a `result` event means the run died rather than finished;
      // stderr is the only explanation the user will get, so pass it through untouched.
      if (code !== 0 && code !== null) {
        pending.push({
          type: 'error',
          message: `claude exited with code ${code}.`,
          detail: stderr.trim() || undefined
        });
      }
      clearInterval(timer);
      flush();
      runs.delete(chat.id);
      resolve();
    });
  });

  runs.set(chat.id, { child, finished });

  // The prompt goes in as a stream-json user message on stdin. Closing stdin is what
  // tells the CLI the turn is complete.
  const message = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] }
  };
  child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdin.end();

  await finished;
}

/** Kill every live agent — called on server shutdown so nothing is left orphaned. */
export async function shutdown(): Promise<void> {
  await Promise.all([...runs.keys()].map((id) => abort(id)));
}
