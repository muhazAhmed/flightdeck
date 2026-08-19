import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CommitDetail, HistoryCommit } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { historyApi } from './api';

const PAGE = 50;

/**
 * The commit log, one commit's detail, and one file's diff inside it.
 *
 * Three levels of selection, each fetched only when reached: the list on open, a commit when clicked, a diff
 * when a file is clicked. Loading a repository's whole history to show twenty rows would make a large project
 * feel broken.
 */
export function useHistory(projectId: string | null, revision: number) {
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [sha, setSha] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  // Guards against a slow response for a commit or file the user has already navigated away from.
  const detailToken = useRef(0);
  const diffToken = useRef(0);

  const report = useCallback((err: unknown) => {
    toast.error(messageOf(err), { description: detailOf(err) });
  }, []);

  const load = useCallback(async () => {
    if (!projectId) {
      setCommits([]);
      return;
    }
    setLoading(true);
    try {
      const result = await historyApi.log(projectId, 0, PAGE);
      setCommits(result.commits);
      setHasMore(result.hasMore);
    } catch (err) {
      report(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, report]);

  // Reloaded when the panel's revision changes, so a commit made here appears at the top immediately.
  useEffect(() => {
    void load();
  }, [load, revision]);

  // Selection belongs to a project; carrying a sha across would ask one repo for another's commit.
  useEffect(() => {
    setSha(null);
    setDetail(null);
    setPath(null);
    setDiff(null);
  }, [projectId]);

  const loadMore = useCallback(async () => {
    if (!projectId || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await historyApi.log(projectId, commits.length, PAGE);
      // Filtered by sha rather than appended blindly: a commit made while the list was open shifts the window
      // by one, which would otherwise show the boundary commit twice.
      const seen = new Set(commits.map((commit) => commit.sha));
      setCommits((current) => [...current, ...result.commits.filter((commit) => !seen.has(commit.sha))]);
      setHasMore(result.hasMore);
    } catch (err) {
      report(err);
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, commits, loadingMore, report]);

  /** Open a commit, or close it if it is already open. */
  const select = useCallback(
    (nextSha: string | null) => {
      setPath(null);
      setDiff(null);
      if (!projectId || nextSha === null || nextSha === sha) {
        setSha(null);
        setDetail(null);
        return;
      }
      setSha(nextSha);
      setDetail(null);
      const token = ++detailToken.current;
      void (async () => {
        try {
          const result = await historyApi.commit(projectId, nextSha);
          if (detailToken.current === token) setDetail(result);
        } catch (err) {
          if (detailToken.current === token) report(err);
        }
      })();
    },
    [projectId, sha, report]
  );

  const selectFile = useCallback(
    (nextPath: string | null) => {
      setPath(nextPath);
      setDiff(null);
      if (!projectId || !sha || !nextPath) return;
      const token = ++diffToken.current;
      void (async () => {
        try {
          const result = await historyApi.diff(projectId, sha, nextPath);
          if (diffToken.current === token) setDiff(result.diff);
        } catch (err) {
          if (diffToken.current === token) report(err);
        }
      })();
    },
    [projectId, sha, report]
  );

  return {
    commits,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    sha,
    detail,
    path,
    diff,
    select,
    selectFile,
    refresh: load
  };
}
