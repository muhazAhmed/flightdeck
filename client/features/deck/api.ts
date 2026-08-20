import type { ProjectOverview } from '@shared/types';
import { http } from '@/lib/http';

export const overviewApi = {
  get: () => http.get<{ projects: ProjectOverview[]; readAt: string }>('/api/overview'),
  /** Fetch every project, so ahead/behind means something. Read-only on each remote. */
  fetchAll: () => http.post<{ fetched: number; failed: number }>('/api/overview/fetch'),
  /**
   * Kill a project's shell from here.
   *
   * Shells outlive the panel that opened them, so the deck is where you find out one is still running in a
   * project you have not opened today — and a list you cannot act on is a worse answer than no list.
   */
  stopShell: (projectId: string) =>
    http.post<{ stopped: boolean }>(`/api/terminal/${encodeURIComponent(projectId)}/stop`)
};
