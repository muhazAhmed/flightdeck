import { useCallback, useEffect, useRef, useState } from 'react';
import type { RateLimitEvent, SessionEvent, UiEvent } from '@shared/types';
import { touchesWorkingTree } from './touchesWorkingTree';

export interface ToolInvocation {
  id: string;
  name: string;
  input: unknown;
  result: string | null;
  isError: boolean;
  startedAt: number;
  finishedAt: number | null;
}

export type Block =
  | { kind: 'prompt'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; tool: ToolInvocation };

export interface RunSummary {
  isError: boolean;
  numTurns: number | null;
  durationMs: number | null;
  costUsd: number | null;
  denials: number;
}

interface StreamState {
  blocks: Block[];
  running: boolean;
  error: { message: string; detail?: string } | null;
  summary: RunSummary | null;
  rateLimit: RateLimitEvent | null;
  /** The handshake from the running CLI: model, cwd, tools it actually has. */
  session: SessionEvent | null;
}

/** Blank line between parts of an error detail. Named because an escaped newline inside a nested
 *  template is exactly the thing that gets mangled by tooling in this codebase. */
const PARAGRAPH = '\n\n';

const IDLE: StreamState = {
  blocks: [],
  running: false,
  error: null,
  summary: null,
  rateLimit: null,
  session: null
};

/**
 * Fold events into transcript state.
 *
 * A module-level pure function rather than an inline closure, because history replay feeds
 * the exact same events through it — a resumed chat must render identically to a live one,
 * and two code paths would eventually disagree.
 */
function reduce(previous: StreamState, events: UiEvent[]): StreamState {
  const blocks = [...previous.blocks];
  let { running, error, summary, rateLimit, session } = previous;

  for (const event of events) {
    switch (event.type) {
      case 'prompt':
        blocks.push({ kind: 'prompt', id: `prompt-${blocks.length}`, text: event.text });
        break;
      case 'text': {
        const last = blocks.at(-1);
        // Append into the trailing text block so prose stays one paragraph rather than
        // fragmenting into a block per delta.
        if (last?.kind === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
        else blocks.push({ kind: 'text', id: `text-${blocks.length}`, text: event.delta });
        break;
      }
      case 'tool_start':
        blocks.push({
          kind: 'tool',
          id: event.id,
          tool: {
            id: event.id,
            name: event.name,
            input: event.input,
            result: null,
            isError: false,
            startedAt: Date.now(),
            finishedAt: null
          }
        });
        break;
      case 'tool_result': {
        const index = blocks.findIndex((b) => b.kind === 'tool' && b.tool.id === event.id);
        if (index >= 0) {
          const block = blocks[index] as Extract<Block, { kind: 'tool' }>;
          blocks[index] = {
            ...block,
            tool: { ...block.tool, result: event.content, isError: event.isError, finishedAt: Date.now() }
          };
        }
        break;
      }
      case 'rate_limit':
        rateLimit = event;
        break;
      case 'error':
        error = { message: event.message, detail: event.detail };
        break;
      case 'done': {
        running = false;
        summary = {
          isError: event.isError,
          numTurns: event.numTurns,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          denials: event.denials.length
        };

        /*
         * A failed run explains itself in `result` and `subtype`, and both used to be dropped here — so a
         * run that died produced a summary line reading "0 turns · 112ms" and nothing else, which is
         * exactly the "something went wrong" this project forbids.
         *
         * Also covers the quieter case: the CLI reports success but produced no assistant text at all.
         * That is not an error it will explain, and an empty transcript with a summary under it looks like
         * the app lost the reply.
         */
        const producedText = blocks.some((block) => block.kind === 'text' && block.text.trim().length > 0);
        if (event.isError) {
          error = {
            message: event.subtype && event.subtype !== 'success' ? `Run failed: ${event.subtype}` : 'The run failed.',
            detail:
              [event.result, event.apiErrorStatus ? `API status: ${event.apiErrorStatus}` : null]
                .filter(Boolean)
                .join(PARAGRAPH) || undefined
          };
        } else if (!producedText && event.numTurns === 0) {
          error = {
            message: 'The run ended without doing anything.',
            detail: [
              event.subtype ? `The CLI reported: ${event.subtype}` : null,
              event.result || null,
              'Nothing was sent to the model — 0 turns. A blocking hook, a session the CLI would not resume, or a rejected argument all look like this.'
            ]
              .filter(Boolean)
              .join(PARAGRAPH)
          };
        }
        break;
      }
      case 'session':
        session = event;
        break;
      case 'turn_end':
        break;
    }
  }

  return { blocks, running, error, summary, rateLimit, session };
}

/**
 * Owns one chat's live transcript.
 *
 * THE PERFORMANCE CONTRACT (CLAUDE.md rule 3): incoming events are appended to a ref and
 * applied to React state on a `requestAnimationFrame` tick. A streamed response arrives
 * as hundreds of small deltas; calling setState per delta re-renders the transcript
 * hundreds of times a second and the app stops feeling like a native tool. The server
 * already coalesces text over a 50ms window — this is the second half of that contract,
 * and both are load-bearing.
 */
export function useChatStream(chatId: string | null, onFilesTouched?: () => void) {
  const [state, setState] = useState<StreamState>(IDLE);

  // Held in a ref so a caller passing an inline arrow does not re-create `applyQueued` — and with it
  // the rAF batching — on every render.
  const filesTouched = useRef(onFilesTouched);
  filesTouched.current = onFilesTouched;

  const queue = useRef<UiEvent[]>([]);
  // `tool_result` carries only the id it answers, so the writer set has to be matched at `tool_start`
  // and remembered. Bounded by the number of tool calls in one chat, which is small.
  const writerCalls = useRef(new Set<string>());
  const frame = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const applyQueued = useCallback(() => {
    frame.current = null;
    const events = queue.current;
    if (events.length === 0) return;
    queue.current = [];
    setState((previous) => reduce(previous, events));

    // Once per frame at most, and only when a writing tool actually finished. The listener debounces
    // further, because one Edit is usually followed by four more.
    const wrote = events.some((event) => event.type === 'tool_result' && writerCalls.current.has(event.id));
    if (wrote) filesTouched.current?.();
  }, []);

  const enqueue = useCallback(
    (event: UiEvent) => {
      if (event.type === 'tool_start' && touchesWorkingTree(event.name)) writerCalls.current.add(event.id);
      queue.current.push(event);
      if (frame.current === null) frame.current = requestAnimationFrame(applyQueued);
    },
    [applyQueued]
  );

  /** Reset when the user switches chats: a transcript belongs to exactly one chat. */
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    cancelFrame();
    queue.current = [];
    writerCalls.current.clear();
    setState(IDLE);
  }, [chatId, cancelFrame]);

  useEffect(() => () => {
    controller.current?.abort();
    cancelFrame();
  }, [cancelFrame]);

  const send = useCallback(
    async (text: string) => {
      if (!chatId) return;

      setState((previous) => ({
        ...previous,
        blocks: [...previous.blocks, { kind: 'prompt', id: `prompt-${Date.now()}`, text }],
        running: true,
        error: null,
        summary: null
      }));

      const abort = new AbortController();
      controller.current = abort;

      try {
        const response = await fetch(`/api/chats/${chatId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: abort.signal
        });

        if (!response.ok || !response.body) {
          // A refusal arrives as JSON, not as a stream.
          let message = `${response.status} ${response.statusText}`;
          let detail: string | undefined;
          try {
            const body = (await response.json()) as { error?: { message?: string; detail?: string } };
            message = body.error?.message ?? message;
            detail = body.error?.detail;
          } catch {
            /* keep the status line */
          }
          enqueue({ type: 'error', message, detail });
          enqueue({
            type: 'done',
            isError: true,
            result: null,
            numTurns: null,
            durationMs: null,
            costUsd: null,
            denials: [],
            // A client-side failure consumed nothing the CLI could report on, and carries no CLI
            // classification either — the message beside it is the whole explanation.
            usage: null,
            subtype: null,
            apiErrorStatus: null
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let carry = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          carry += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; a chunk can split one in half.
          const frames = carry.split('\n\n');
          carry = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              enqueue(JSON.parse(line.slice(6)) as UiEvent);
            } catch {
              /* a truncated frame is not worth killing the stream over */
            }
          }
        }
      } catch (error) {
        if (abort.signal.aborted) {
          setState((previous) => ({ ...previous, running: false }));
          return;
        }
        enqueue({
          type: 'error',
          message: 'The stream was interrupted.',
          detail: error instanceof Error ? error.message : String(error)
        });
        enqueue({
            type: 'done',
            isError: true,
            result: null,
            numTurns: null,
            durationMs: null,
            costUsd: null,
            denials: [],
            // A client-side failure consumed nothing the CLI could report on, and carries no CLI
            // classification either — the message beside it is the whole explanation.
            usage: null,
            subtype: null,
            apiErrorStatus: null
          });
      } finally {
        controller.current = null;
      }
    },
    [chatId, enqueue]
  );

  /** Local stop: drops the reader. The server also kills the process when the response
   *  closes, so the agent does not keep working against the repo. */
  const stop = useCallback(() => {
    controller.current?.abort();
    setState((previous) => ({ ...previous, running: false }));
  }, []);

  /** Replace the transcript with replayed history. Same reducer as the live stream, so a
   *  reopened chat is indistinguishable from one you just watched.
   *
   *  Deliberately bypasses `enqueue`, so replaying a transcript full of Edits does not announce that
   *  files were touched — that happened hours ago, and the panel already reflects it. */
  const hydrate = useCallback((events: UiEvent[]) => {
    setState(reduce(IDLE, events));
  }, []);

  return { ...state, send, stop, hydrate };
}
