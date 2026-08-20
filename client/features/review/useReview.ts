import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ReviewContext, ReviewResult } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { reviewApi } from './api';
import { IDLE, streamReview, type ReviewProgress } from './stream';

/**
 * Reviewing a project's own branch: what there is to review, and running it.
 *
 * The context is read before the button is offered, so a clean tree says "nothing differs from origin/dev"
 * rather than spending a run to discover it.
 */
export function useReview(projectId: string | null) {
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [progress, setProgress] = useState<ReviewProgress>(IDLE);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setContext(null);
      setResult(null);
      return;
    }
    try {
      const answer = await reviewApi.get(projectId);
      setContext(answer.context);
      setResult(answer.last);
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A review belongs to the project it was run for; switching must not leave the previous one running or shown.
  useEffect(() => {
    setProgress(IDLE);
    return () => abort.current?.abort();
  }, [projectId]);

  const start = useCallback(async () => {
    if (!projectId) return;
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ ...IDLE, running: true, activity: 'Starting…' });
    setResult(null);

    try {
      await streamReview(`/api/projects/${encodeURIComponent(projectId)}/review`, {
        onProgress: setProgress,
        onResult: (review) => {
          setResult(review);
          if (review.error) toast.error('The review did not finish', { description: review.error });
        },
        onRefused: (message, detail) => toast.error(message, { description: detail }),
        signal: controller.signal
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error('The review stream was interrupted.', {
          description: err instanceof Error ? err.message : String(err)
        });
      }
    } finally {
      abort.current = null;
      setProgress(IDLE);
      // The tree may have moved on while the review ran; the counts beside the button must not lie.
      void load();
    }
  }, [projectId, load]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const discard = useCallback(async () => {
    if (!projectId) return;
    setResult(null);
    try {
      await reviewApi.discard(projectId);
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, [projectId]);

  return { context, result, progress, start, stop, discard, refresh: load };
}
