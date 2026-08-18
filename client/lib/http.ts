import type { ApiError } from '@shared/types';

/**
 * Thrown for every non-2xx response. Carries the server's `detail` — raw stderr from git
 * or claude — because a message the user cannot act on is worse than no message at all.
 */
export class RequestError extends Error {
  readonly detail?: string;
  readonly code?: string;
  readonly status: number;

  constructor(status: number, message: string, detail?: string, code?: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

async function parseError(response: Response): Promise<RequestError> {
  try {
    const body = (await response.json()) as ApiError;
    const error = body?.error;
    if (error?.message) return new RequestError(response.status, error.message, error.detail, error.code);
  } catch {
    /* not JSON — fall through to the status line */
  }
  return new RequestError(response.status, `${response.status} ${response.statusText}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers
    });
  } catch (cause) {
    // The server being down is normal for a local tool; say so plainly.
    throw new RequestError(0, 'Cannot reach the Flight Deck server.', cause instanceof Error ? cause.message : undefined);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const http = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' })
};

/** Turns a thrown value into something safe to put in a toast. */
export function messageOf(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function detailOf(error: unknown): string | undefined {
  return error instanceof RequestError ? error.detail : undefined;
}
