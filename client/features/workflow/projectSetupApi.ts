import type { ApiError } from '@shared/types';
import type { ProjectWorkflowConfig } from '@shared/workflow';
import { http, RequestError } from '@/lib/http';

export interface ProjectWorkflowInput {
  /** Null keeps using the commands detected from package.json. */
  commands: string[] | null;
  knowledge: string;
}

const path = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workflow`;

/** `http` has no PUT, and adding one for a single caller would widen a file everything depends on. */
async function put(projectId: string, body: ProjectWorkflowInput): Promise<ProjectWorkflowConfig> {
  let response: Response;
  try {
    response = await fetch(path(projectId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    throw new RequestError(0, 'Cannot reach the Flight Deck server.', cause instanceof Error ? cause.message : undefined);
  }
  if (!response.ok) {
    try {
      const error = ((await response.json()) as ApiError)?.error;
      if (error?.message) throw new RequestError(response.status, error.message, error.detail, error.code);
    } catch (err) {
      if (err instanceof RequestError) throw err;
      /* not JSON — fall through to the status line */
    }
    throw new RequestError(response.status, `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ProjectWorkflowConfig;
}

export const projectSetupApi = {
  get: (projectId: string) => http.get<ProjectWorkflowConfig>(path(projectId)),
  save: put
};
