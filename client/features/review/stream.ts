import type { ReviewEvent, ReviewResult } from '@shared/types';

export interface ReviewProgress {
  running: boolean;
  /** What the agent is doing right now, in a few words. Replaced, never accumulated. */
  activity: string | null;
  /** Files opened with the Read tool. */
  filesRead: number;
  /**
   * Commands run.
   *
   * Counted separately because the two kinds of review read differently, which a single "files read" counter
   * hid: a branch review opens files in your working tree with Read, while a pull-request review reads them at
   * the pull request's own revision with `git show` — so its file count was honestly zero while it worked
   * through twelve commands. Measured on the first real pull-request review: 12 turns, 0 Reads.
   */
  commands: number;
}

export const IDLE: ReviewProgress = { running: false, activity: null, filesRead: 0, commands: 0 };

/** "5 files read · 9 commands", omitting whichever is zero. Empty while nothing has happened yet. */
export function effort(progress: ReviewProgress): string {
  const parts: string[] = [];
  if (progress.filesRead > 0) parts.push(`${progress.filesRead} files read`);
  if (progress.commands > 0) parts.push(`${progress.commands} command${progress.commands === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** One short line about what the agent is doing. Filenames only — a shell command could be a page long. */
export function describe(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const path = typeof record.file_path === 'string' ? record.file_path : null;
  if (name === 'Read' && path) return `Reading ${path.split(/[\/]/).pop() ?? path}`;
  if (name === 'Bash') return 'Reading the diff';
  if (name === 'Grep' || name === 'Glob') return 'Searching the repository';
  return name;
}

/**
 * Consume a review stream.
 *
 * Shared by the branch reviewer and the pull-request reviewer, which differ only in their URL: a second copy of
 * SSE framing is a second place for a half-frame bug to live.
 *
 * `EventSource` cannot POST, and a review is a request with a body rather than a subscription — so this is a
 * `fetch` whose body is server-sent events, exactly as the chat stream does it.
 */
export async function streamReview(
  url: string,
  handlers: {
    onProgress: (progress: ReviewProgress) => void;
    onResult: (result: ReviewResult) => void;
    onRefused: (message: string, detail?: string) => void;
    signal: AbortSignal;
  }
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: handlers.signal
  });

  if (!response.ok || !response.body) {
    // A refusal arrives as JSON rather than a stream: an empty diff, an unreadable pull request, a failed fetch.
    let message = `The review could not start (${response.status}).`;
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string; detail?: string } };
      message = body.error?.message ?? message;
      detail = body.error?.detail;
    } catch {
      /* keep the status line */
    }
    handlers.onRefused(message, detail);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let files = 0;
  let commands = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line, and a chunk can split one in half.
    const frames = carry.split('\n\n');
    carry = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let event: ReviewEvent;
      try {
        event = JSON.parse(line.slice(6)) as ReviewEvent;
      } catch {
        continue;
      }
      if (event.type === 'tool_start') {
        if (event.name === 'Read') files += 1;
        if (event.name === 'Bash') commands += 1;
        handlers.onProgress({
          running: true,
          activity: describe(event.name, event.input),
          filesRead: files,
          commands
        });
      }
      if (event.type === 'review') handlers.onResult(event.review);
    }
  }
}
