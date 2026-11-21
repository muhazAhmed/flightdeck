import type { TaskSummary } from '@shared/workflow';
import { http } from '@/lib/http';

export const tasksApi = {
  /** Every task across all projects, newest first. */
  list: () => http.get<TaskSummary[]>('/api/tasks'),
  /** Creates the task and starts its first run. */
  create: (projectId: string, description: string, model: string) =>
    http.post<TaskSummary>('/api/tasks', { projectId, description, model }),
  /** A follow-up to the lead, resuming its session. */
  message: (id: string, text: string) => http.post<TaskSummary>(`/api/tasks/${id}/message`, { text }),
  stop: (id: string) => http.post<{ ok: true }>(`/api/tasks/${id}/stop`),
  remove: (id: string) => http.delete<{ ok: true }>(`/api/tasks/${id}`)
};
