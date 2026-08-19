import { http } from '@/lib/http';
import type {
  CommitDetail,
  HistoryCommit,
  BranchList,
  BranchResult,
  CommitMessageDraft,
  GitStatus,
  IdentityState,
  RemoteResult,
  SavedIdentity,
  StageResult,
  StashEntry
} from '@shared/types';

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

  /** Drafts a message from the staged diff. Suggestion only — it never commits. */
  draftMessage: (projectId: string, model?: string) =>
    http.post<CommitMessageDraft>('/api/git/commit-message', { projectId, model }),

  stashList: (projectId: string) =>
    http.get<StashEntry[]>(`/api/git/stash-list?projectId=${encodeURIComponent(projectId)}`),
  stash: (projectId: string, message?: string, includeUntracked = true) =>
    http.post<GitStatus>('/api/git/stash', { projectId, message, includeUntracked }),
  stashPop: (projectId: string, index = 0) => http.post<GitStatus>('/api/git/stash-pop', { projectId, index }),
  /** Deletes without applying. `expectSubject` is what the row displayed — the server refuses if the list moved. */
  stashDrop: (projectId: string, index: number, expectSubject: string) =>
    http.post<GitStatus>('/api/git/stash-drop', { projectId, index, expectSubject }),

  // Remote operations answer with git's own summary plus the fresh status. The remote and
  // branch are never sent from here — the server reads them from the repository's config,
  // so a client can't push somewhere the repo isn't already pointed at.
  fetch: (projectId: string) => http.post<RemoteResult>('/api/git/fetch', { projectId }),
  pull: (projectId: string) => http.post<RemoteResult>('/api/git/pull', { projectId }),
  push: (projectId: string) => http.post<RemoteResult>('/api/git/push', { projectId }),

  /** Empty commit then push, to make a pipeline that only runs on new commits run again. Refused by
   *  the server when anything is staged — an empty commit would carry it along. */
  triggerBuild: (projectId: string) => http.post<RemoteResult>('/api/git/trigger-build', { projectId })
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

export const branchApi = {
  list: (projectId: string) =>
    http.get<BranchList>(`/api/git/branches?projectId=${encodeURIComponent(projectId)}`),

  /** Refused with `GIT_DIRTY` when the tree has uncommitted work — git would otherwise carry
   *  it onto the other branch. */
  checkout: (projectId: string, branch: string) =>
    http.post<BranchResult>('/api/git/checkout', { projectId, branch }),

  /** Creating a branch deliberately does not require a clean tree: the working changes come
   *  along, which is the point when you realise mid-edit that this should not be on main. */
  create: (projectId: string, branch: string, from?: string) =>
    http.post<BranchResult>('/api/git/branch', { projectId, branch, from }),

  remove: (projectId: string, branch: string, force = false) =>
    http.delete<{ summary: string; branches: BranchList }>(
      `/api/git/branch/${encodeURIComponent(branch)}?projectId=${encodeURIComponent(projectId)}&force=${force}`
    )
};

/**
 * Commit history. Read-only — there is no revert, reset or cherry-pick here, and no route to add one to.
 */
export const historyApi = {
  log: (projectId: string, skip = 0, limit = 50) =>
    http.get<{ commits: HistoryCommit[]; hasMore: boolean }>(
      `/api/git/log?projectId=${encodeURIComponent(projectId)}&skip=${skip}&limit=${limit}`
    ),
  commit: (projectId: string, sha: string) =>
    http.get<CommitDetail>(
      `/api/git/commit?projectId=${encodeURIComponent(projectId)}&sha=${encodeURIComponent(sha)}`
    ),
  diff: (projectId: string, sha: string, path: string) =>
    http.get<{ diff: string }>(
      `/api/git/commit-diff?projectId=${encodeURIComponent(projectId)}&sha=${encodeURIComponent(sha)}&path=${encodeURIComponent(path)}`
    )
};

