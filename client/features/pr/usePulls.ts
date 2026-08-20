import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { PullRequest, RepoRef } from '@shared/types';
import { detailOf, http, messageOf } from '@/lib/http';

export interface ProjectPulls {
  projectId: string;
  projectName: string;
  repo: RepoRef | null;
  pulls: PullRequest[];
  reason: string | null;
  code: 'OK' | 'NO_REMOTE' | 'NOT_GITHUB' | 'NO_ACCESS' | 'NOT_SIGNED_IN' | 'OFFLINE' | 'FAILED';
}

/**
 * Every project's open pull requests.
 *
 * Across all of them rather than the selected one: "which of my repositories have something waiting?" is the
 * question this page exists to answer, and an editor cannot answer it at all.
 */
export function usePulls(selectedId: string | null) {
  const [groups, setGroups] = useState<ProjectPulls[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const answer = await http.get<{ projects: ProjectPulls[] }>('/api/pulls');
      setGroups(answer.projects);
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(() => (groups ? rank(groups, selectedId) : null), [groups, selectedId]);
  return { groups: ordered, loading, refresh: load };
}

/**
 * Most recently active first, with the project you are in kept at the top.
 *
 * Quiet projects sink rather than disappear: seeing "none" for a repository is an answer, and a list that
 * silently omits it invites the question of whether it was checked at all. Anything unreadable sits above the
 * quiet ones, since it is the only row here with something to fix.
 */
export function rank(groups: ProjectPulls[], selectedId: string | null): ProjectPulls[] {
  const newest = (group: ProjectPulls): number =>
    group.pulls.reduce((latest, pull) => Math.max(latest, Date.parse(pull.updatedAt) || 0), 0);

  const weight = (group: ProjectPulls): number => {
    if (group.pulls.length > 0) return 0;
    if (group.code !== 'OK' && group.code !== 'NO_REMOTE') return 1;
    return 2;
  };

  return [...groups].sort((a, b) => {
    if (a.projectId === selectedId) return -1;
    if (b.projectId === selectedId) return 1;
    return weight(a) - weight(b) || newest(b) - newest(a) || a.projectName.localeCompare(b.projectName);
  });
}
