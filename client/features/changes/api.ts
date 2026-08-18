import { http } from '@/lib/http';
import type { GitStatus, IdentityState, RemoteResult, SavedIdentity, StageResult, StashEntry } from '@shared/types';

interface CommitResult {
  commit: string;
  summary: { changes: number; insertions: number; deletions: number };
  status: GitStatus;
}

export const gitApi = {
  status: (projectId: string) => http.get<GitStatus>(`/api/git/status?projectId=${encodeURIComponent(projectId)}`),

  diff: (projectId: string, file: string, staged = false) =>
    http.get<{ diff: string }>(
      `/api/git/diff?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(file)}&staged=${staged}`
    ),

  // Every mutation answers with the fresh status, so the panel never needs a follow-up
  // request to learn what its own action did.
  stage: (projectId: string, files: string[]) => http.post<StageResult>('/api/git/stage', { projectId, files }),
  unstage: (projectId: string, files: string[]) => http.post<GitStatus>('/api/git/unstage', { projectId, files }),
  discard: (projectId: string, files: string[]) => http.post<GitStatus>('/api/git/discard', { projectId, files }),

  commit: (projectId: string, message: string, files?: string[]) =>
    http.post<CommitResult>('/api/git/commit', { projectId, message, files }),

  stashList: (projectId: string) =>
    http.get<StashEntry[]>(`/api/git/stash-list?projectId=${encodeURIComponent(projectId)}`),
  stash: (projectId: string, message?: string, includeUntracked = true) =>
    http.post<GitStatus>('/api/git/stash', { projectId, message, includeUntracked }),
  stashPop: (projectId: string, index = 0) => http.post<GitStatus>('/api/git/stash-pop', { projectId, index }),

  // Remote operations answer with git's own summary plus the fresh status. The remote and
  // branch are never sent from here — the server reads them from the repository's config,
  // so a client can't push somewhere the repo isn't already pointed at.
  fetch: (projectId: string) => http.post<RemoteResult>('/api/git/fetch', { projectId }),
  pull: (projectId: string) => http.post<RemoteResult>('/api/git/pull', { projectId }),
  push: (projectId: string) => http.post<RemoteResult>('/api/git/push', { projectId })
};

export const identityApi = {
  get: (projectId: string) =>
    http.get<IdentityState>(`/api/git/identity?projectId=${encodeURIComponent(projectId)}`),

  /** Applies to the given repository only (`git config --local`). `save` also remembers it
   *  for the switcher. */
  set: (projectId: string, name: string, email: string, save = false, label?: string) =>
    http.post<IdentityState>('/api/git/identity', { projectId, name, email, save, label }),

  /** Removes a shortcut. Never changes what any repository commits as. */
  forget: (id: string) => http.delete<{ ok: true; saved: SavedIdentity[] }>(`/api/identities/${id}`)
};
