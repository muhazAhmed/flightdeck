import type { ProjectUsageReport, UsageReport } from '@shared/types';
import { http } from '@/lib/http';

export const usageApi = {
  get: (days: number) => http.get<UsageReport>(`/api/usage?days=${days}`),
  project: (projectId: string, days: number) =>
    http.get<ProjectUsageReport>(
      `/api/usage/project?projectId=${encodeURIComponent(projectId)}&days=${days}`
    )
};
