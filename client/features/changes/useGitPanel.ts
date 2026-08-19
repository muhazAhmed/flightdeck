import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { GitStatus, StashEntry } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { gitApi } from './api';

export interface SelectedFile {
  path: string;
  staged: boolean;
}

/**
 * All source-control state and actions for one project, so the panel component stays a
 * rendering concern.
 *
 * Mutations return the fresh status from the server rather than refetching, which keeps
 * the list from flickering between "acted" and "reloaded".
 */
export function useGitPanel(projectId: string | null, revision: number) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Incremented by anything that changes git state, so dependants (the branch list) can
  // refresh without this hook needing to know they exist.
  const [mutations, setMutations] = useState(0);

  // Guards against a slow diff response for a file the user has already navigated away
  // from overwriting the diff they are now looking at.
  const diffToken = useRef(0);

  // A live refresh must never adopt a status read that raced a mutation the user just triggered.
  const busyRef = useRef(false);
  busyRef.current = busy;

  const report = useCallback((err: unknown) => {
    toast.error(messageOf(err), { description: detailOf(err) });
  }, []);

  /**
   * Read status and stashes.
   *
   * `quiet` is for refreshes the user did not ask for — the ones that fire while the agent is editing.
   * They must not raise `loading`, because that spins the Fetch button and reads as "the tool is doing
   * network work", and they are skipped outright while a mutation is in flight: adopting a status read
   * that raced a stage or a commit would show the wrong list. Nothing is lost by skipping, since the
   * run ending always triggers one more refresh.
   */
  const refresh = useCallback(async (options?: { quiet?: boolean }) => {
    if (!projectId) {
      setStatus(null);
      setStashes([]);
      return;
    }
    if (options?.quiet && busyRef.current) return;
    if (!options?.quiet) setLoading(true);
    try {
      const [nextStatus, nextStashes] = await Promise.all([
        gitApi.status(projectId),
        gitApi.stashList(projectId).catch(() => [])
      ]);
      setStatus(nextStatus);
      setStashes(nextStashes);
      setError(null);
    } catch (err) {
      // A failed background poll must not replace a working panel with an error banner; the next tick
      // or the user's own refresh will say so if it is really broken.
      if (!options?.quiet) setError(messageOf(err));
    } finally {
      if (!options?.quiet) setLoading(false);
    }
  }, [projectId]);

  // Loud on mount and whenever the project changes: this is the read the user is waiting for.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Quiet for revision bumps — the agent touching files, or a run finishing. Skipped on the first
  // pass so opening a project does not read status twice.
  const firstRevision = useRef(revision);
  useEffect(() => {
    if (revision === firstRevision.current) return;
    void refresh({ quiet: true });
  }, [revision, refresh]);

  // Selection belongs to a project; carrying it across would show one repo's diff under
  // another repo's file list.
  useEffect(() => {
    setSelected(null);
    setDiff(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !selected) {
      setDiff(null);
      return;
    }
    const token = ++diffToken.current;
    void (async () => {
      try {
        const result = await gitApi.diff(projectId, selected.path, selected.staged);
        if (diffToken.current === token) setDiff(result.diff);
      } catch (err) {
        if (diffToken.current === token) {
          setDiff(null);
          report(err);
        }
      }
    })();
  }, [projectId, selected, revision, report]);

  /** Every mutation shares this shape: disable the controls, apply, adopt the returned
   *  status, and surface git's own message on failure. */
  const run = useCallback(
    async (action: () => Promise<GitStatus>) => {
      setBusy(true);
      try {
        setStatus(await action());
        setError(null);
        setMutations((n) => n + 1);
        return true;
      } catch (err) {
        report(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [report]
  );

  /** Staging is partial: a nested git repository cannot be added, and letting one such
   *  path fail the whole batch would make "stage all" appear to do nothing. The server
   *  stages the rest and names what it skipped; that must be said out loud, or the user
   *  is left believing everything went in. */
  const stage = useCallback(
    async (files: string[]) => {
      if (!projectId) return false;
      setBusy(true);
      try {
        const result = await gitApi.stage(projectId, files);
        setStatus(result.status);
        setError(null);
        for (const skipped of result.skipped) {
          toast.warning(`Skipped ${skipped.path}`, { description: skipped.reason });
        }
        return true;
      } catch (err) {
        report(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId, report]
  );

  const unstage = useCallback(
    (files: string[]) => (projectId ? run(() => gitApi.unstage(projectId, files)) : Promise.resolve(false)),
    [projectId, run]
  );

  const discard = useCallback(
    async (files: string[]) => {
      if (!projectId) return false;
      const ok = await run(() => gitApi.discard(projectId, files));
      if (ok) {
        toast.success(files.length === 1 ? `Discarded changes to ${files[0]}` : `Discarded ${files.length} files`);
        setSelected((current) => (current && files.includes(current.path) ? null : current));
      }
      return ok;
    },
    [projectId, run]
  );

  const commit = useCallback(
    async (message: string) => {
      if (!projectId) return false;
      setBusy(true);
      try {
        const result = await gitApi.commit(projectId, message);
        setStatus(result.status);
        setSelected(null);
        setMutations((n) => n + 1);
        const { changes, insertions, deletions } = result.summary;
        toast.success(`Committed ${result.commit.slice(0, 7)}`, {
          description: `${changes} file${changes === 1 ? '' : 's'} · +${insertions} −${deletions}`
        });
        return true;
      } catch (err) {
        report(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId, report]
  );

  const stash = useCallback(
    async (message?: string) => {
      if (!projectId) return false;
      const ok = await run(() => gitApi.stash(projectId, message));
      if (ok) {
        setSelected(null);
        setStashes(await gitApi.stashList(projectId).catch(() => stashes));
      }
      return ok;
    },
    [projectId, run, stashes]
  );

  /** fetch / pull / push share a shape: run it, adopt the new status, and show git's own
   *  summary. Failures (auth, non-fast-forward, no network) surface verbatim. */
  const remote = useCallback(
    async (operation: 'fetch' | 'pull' | 'push') => {
      if (!projectId) return false;
      setBusy(true);
      try {
        const result = await gitApi[operation](projectId);
        setStatus(result.status);
        setError(null);
        toast.success(`${operation[0]?.toUpperCase()}${operation.slice(1)} done`, { description: result.summary });
        return true;
      } catch (err) {
        report(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId, report]
  );

  const stashDrop = useCallback(
    async (index: number, subject: string) => {
      if (!projectId) return false;
      const ok = await run(() => gitApi.stashDrop(projectId, index, subject));
      if (ok) {
        toast.success('Stash dropped');
        // Dropping renumbers the rest, so the list is re-read rather than spliced locally.
        setStashes(await gitApi.stashList(projectId).catch(() => stashes));
      }
      return ok;
    },
    [projectId, run, stashes]
  );

  const stashPop = useCallback(
    async (index: number) => {
      if (!projectId) return false;
      const ok = await run(() => gitApi.stashPop(projectId, index));
      if (ok) setStashes(await gitApi.stashList(projectId).catch(() => stashes));
      return ok;
    },
    [projectId, run, stashes]
  );

  return {
    status,
    stashes,
    selected,
    diff,
    loading,
    busy,
    error,
    select: setSelected,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    stash,
    stashPop,
    stashDrop,
    remote,
    mutations,
    /** For a checkout: the branch routes already return the post-switch status, so adopt it
     *  rather than firing another read. */
    adoptStatus: (next: GitStatus) => {
      setStatus(next);
      setSelected(null);
      setMutations((n) => n + 1);
    }
  };
}
