import type { ProjectOverview } from '@shared/types';
import { http } from '@/lib/http';

export const overviewApi = {
  get: () => http.get<{ projects: ProjectOverview[]; readAt: string }>('/api/overview'),
  /** Fetch every project, so ahead/behind means something. Read-only on each remote. */
  fetchAll: () => http.post<{ fetched: number; failed: number }>('/api/overview/fetch')
};
