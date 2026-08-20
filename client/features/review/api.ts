import type { ReviewContext, ReviewResult } from '@shared/types';
import { http } from '@/lib/http';

export const reviewApi = {
  /** What there is to review, plus the last review if one has been run since the server started. */
  get: (projectId: string) =>
    http.get<{ context: ReviewContext; last: ReviewResult | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/review`
    ),
  discard: (projectId: string) =>
    http.delete<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/review`)
};
