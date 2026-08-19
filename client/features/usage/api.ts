import type { ProjectTranscriptUsage, ProjectUsageReport, UsageReport } from '@shared/types';
import { http } from '@/lib/http';

export const usageApi = {
  get: (days: number) => http.get<UsageReport>(`/api/usage?days=${days}`),
  project: (projectId: string, days: number) =>
    http.get<ProjectUsageReport>(
      `/api/usage/project?projectId=${encodeURIComponent(projectId)}&days=${days}`
    ),
  /** Work found in the CLI's transcripts, including sessions never run through Flight Deck. */
  transcripts: () => http.get<{ projects: ProjectTranscriptUsage[] }>('/api/usage/transcripts')
};
