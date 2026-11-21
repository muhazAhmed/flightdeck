import { useEffect, useRef, useState } from 'react';
import type { UiEvent } from '@shared/types';
import { EMPTY_VIEW, foldTask, type TaskView } from './foldTask';

/**
 * One task's activity: its history, then live events for as long as it runs.
 *
 * Unlike a chat's stream, closing this does nothing to the task — it is a window onto a run the server owns,
 * which is what lets you look at another task, or leave the page, without stopping the first.
 *
 * `runs` is part of the key because a follow-up starts a new run on the same task: the previous stream has
 * ended by then, and the log is re-read from the top so the view is the whole story rather than a splice.
 *
 * THE PERFORMANCE CONTRACT (CLAUDE.md rule 3) applies here exactly as in useChatStream: events are pooled in
 * a ref and folded into state once per animation frame, never per event.
 */
export function useTaskStream(taskId: string | null, runs: number, onEnded: () => void) {
  const [view, setView] = useState<TaskView>(EMPTY_VIEW);
  const [loading, setLoading] = useState(false);

  // Held in a ref so an inline callback from the caller does not restart the stream on every render.
  const ended = useRef(onEnded);
  ended.current = onEnded;

  useEffect(() => {
    setView(EMPTY_VIEW);
    if (!taskId) return;

    const abort = new AbortController();
    let queue: UiEvent[] = [];
    let frame: number | null = null;

    const flush = () => {
      frame = null;
      if (queue.length === 0) return;
      const batch = queue;
      queue = [];
      setView((previous) => foldTask(previous, batch));
    };
    const enqueue = (event: UiEvent) => {
      queue.push(event);
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/events`, { signal: abort.signal });
        if (!response.ok || !response.body) {
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
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let carry = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          setLoading(false);
          carry += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line; a chunk can split one in half.
          const frames = carry.split('\n\n');
          carry = frames.pop() ?? '';
          for (const sse of frames) {
            const line = sse.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              enqueue(JSON.parse(line.slice(6)) as UiEvent);
            } catch {
              /* a truncated frame is not worth killing the stream over */
            }
          }
        }
        // The server closes the stream when the run is over; the list needs to learn the new status.
        if (!abort.signal.aborted) ended.current();
      } catch (error) {
        if (abort.signal.aborted) return;
        enqueue({
          type: 'error',
          message: 'Lost the connection to this task.',
          detail: `${error instanceof Error ? error.message : String(error)} — the task itself keeps running on the server; reopen it to reattach.`
        });
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      abort.abort();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [taskId, runs]);

  return { view, loading };
}
