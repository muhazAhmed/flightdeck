import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectOverview } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { overviewApi } from './api';
import { byAttention } from './attention';

/**
 * The deck's data: one read across every project, ranked.
 *
 * Loaded on open rather than polled. Twenty repositories is forty git processes, which is cheap once
 * and rude every ten seconds — and the deck is a screen you look at deliberately, not a monitor you
 * leave running.
 */
export function useDeck(open: boolean) {
  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await overviewApi.get();
      setProjects(result.projects);
      setReadAt(result.readAt);
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * Fetch every remote, then re-read.
   *
   * Worth its own button because ahead/behind is measured against local remote refs: on a deck that
   * has not fetched today, every card reads 0/0, which looks like "nothing to push".
   */
  const fetchAll = useCallback(async () => {
    setFetching(true);
    try {
      const result = await overviewApi.fetchAll();
      if (result.failed > 0) {
        toast.warning(`Fetched ${result.fetched}, ${result.failed} failed`, {
          description: 'Unreachable remotes keep their old counts — nothing else is affected.'
        });
      } else if (result.fetched > 0) {
        toast.success(`Fetched ${result.fetched} ${result.fetched === 1 ? 'repository' : 'repositories'}`);
      }
      await load();
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setFetching(false);
    }
  }, [load]);

  // Sorted once per read rather than per render: `byAttention` calls Date.now() and a ranking that
  // shifts mid-interaction would move cards under the pointer.
  const ranked = useMemo(() => {
    const now = Date.now();
    return [...projects].sort((a, b) => byAttention(a, b, now));
  }, [projects]);

  const totals = useMemo(() => {
    const dirty = projects.filter(
      (p) => p.stagedCount + p.unstagedCount + p.untrackedCount > 0
    ).length;
    return {
      count: projects.length,
      dirty,
      unpushed: projects.filter((p) => p.ahead > 0).length,
      behind: projects.filter((p) => p.behind > 0).length,
      broken: projects.filter((p) => p.missing || p.error !== null).length
    };
  }, [projects]);

  return { projects: ranked, totals, readAt, loading, fetching, refresh: load, fetchAll };
}
