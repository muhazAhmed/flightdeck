import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PullRequest, ReviewResult } from '@shared/types';
import { detailOf, http, messageOf } from '@/lib/http';
import { IDLE, streamReview, type ReviewProgress } from '@/features/review/stream';

interface PullDetail {
  pull: PullRequest;
  diff: string;
  files: string[];
  body: string;
  reason: string | null;
  last: ReviewResult | null;
}

/**
 * One pull request: its facts, its patch, and reviewing it.
 *
 * The review is the same run as a branch review — same prompt shape, same parser, same accounting — against the
 * pull request's own commit instead of your working tree. The server fetches that commit into a ref before
 * starting; nothing is checked out.
 */
export function usePullReview(projectId: string | null, number: number | null) {
  const [detail, setDetail] = useState<PullDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [progress, setProgress] = useState<ReviewProgress>(IDLE);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!projectId || number === null) {
      setDetail(null);
      setResult(null);
      return;
    }
    setLoading(true);
    try {
      const answer = await http.get<PullDetail>(
        `/api/projects/${encodeURIComponent(projectId)}/pulls/${number}`
      );
      setDetail(answer);
      // A review of this pull request from earlier in the session, if there is one.
      setResult(answer.last);
    } catch (err) {
      setDetail(null);
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setLoading(false);
    }
  }, [projectId, number]);

  useEffect(() => {
    void load();
  }, [load]);

  // Selecting another pull request must not leave the previous review running or on screen.
  useEffect(() => {
    setProgress(IDLE);
    return () => abort.current?.abort();
  }, [projectId, number]);

  const start = useCallback(async () => {
    if (!projectId || number === null) return;
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ ...IDLE, running: true, activity: 'Fetching the pull request…' });
    setResult(null);

    try {
      await streamReview(`/api/projects/${encodeURIComponent(projectId)}/pulls/${number}/review`, {
        onProgress: setProgress,
        onResult: (review) => {
          setResult(review);
          if (review.error) toast.error('The review did not finish', { description: review.error });
        },
        onRefused: (message, detailText) => toast.error(message, { description: detailText }),
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
    }
  }, [projectId, number]);

  const stop = useCallback(() => abort.current?.abort(), []);

  return { detail, loading, result, progress, start, stop, refresh: load };
}
