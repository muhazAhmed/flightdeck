import { http } from '@/lib/http';
import type { BrowseResult, Project } from '@shared/types';

export const projectsApi = {
  list: () => http.get<Project[]>('/api/projects'),
  add: (path: string) => http.post<Project>('/api/projects', { path }),
  remove: (id: string) => http.delete<{ ok: true }>(`/api/projects/${id}`),
  browse: (dir?: string) =>
    http.get<BrowseResult>(dir ? `/api/fs/browse?dir=${encodeURIComponent(dir)}` : '/api/fs/browse')
};
