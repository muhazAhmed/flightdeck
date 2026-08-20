import { AlertTriangle, GitPullRequest, RefreshCw, ScanSearch } from 'lucide-react';
import type { Project } from '@shared/types';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import type { ProjectPulls } from './usePulls';

export type PrSelection = { kind: 'branch' } | { kind: 'pull'; projectId: string; number: number };

interface PrSidebarProps {
  project: Project | null;
  groups: ProjectPulls[] | null;
  loading: boolean;
  selection: PrSelection;
  onSelect: (selection: PrSelection) => void;
  onRefresh: () => void;
}

/**
 * What there is to look at, in one column.
 *
 * The whole page used to be one stacked card: the branch review, then every project's pull requests, then the
 * diff of whatever you were reading, all in one scroll. Four pull requests already made it unusable — reported
 * as "everything is spammed in one card", which was fair.
 *
 * So this is a list and a detail pane, which is what every mail client and every code-review tool converges on
 * for the same reason: the list stays scannable while the thing you are reading gets the room.
 */
export function PrSidebar({ project, groups, loading, selection, onSelect, onRefresh }: PrSidebarProps) {
  const total = groups?.reduce((sum, group) => sum + group.pulls.length, 0) ?? 0;

  return (
    <nav className="flex h-full min-h-0 flex-col border-r border-border-subtle bg-surface-1">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="min-w-0 flex-1 text-[12px] text-text-muted">
          {groups ? `${total} open · ${groups.length} ${groups.length === 1 ? 'project' : 'projects'}` : 'Asking GitHub…'}
        </span>
        <IconButton
          label="Re-read from GitHub"
          icon={<RefreshCw size={13} className={cn(loading && 'animate-spin')} />}
          disabled={loading}
          onClick={onRefresh}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {/* The local half, first and always available: it needs no GitHub at all. */}
        <button
          type="button"
          onClick={() => onSelect({ kind: 'branch' })}
          className={cn(
            'flex w-full items-start gap-2 px-3 py-2 text-left',
            'transition-colors duration-(--duration-fast) hover:bg-surface-2',
            selection.kind === 'branch' && 'bg-accent-subtle'
          )}
        >
          <ScanSearch size={13} className="mt-0.5 shrink-0 text-accent-bright" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-5">Review this branch</span>
            <span className="block truncate text-[11.5px] text-text-muted">
              {project ? project.name : 'no project selected'}
            </span>
          </span>
        </button>

        <p className="mt-2 px-3 pb-1 text-[11px] tracking-wide text-text-muted uppercase">Open pull requests</p>

        {!groups && loading ? (
          <div className="flex flex-col gap-1 px-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : null}

        {groups?.map((group) => (
          <div key={group.projectId} className="mt-1">
            <p className="flex min-w-0 items-baseline gap-1.5 px-3 py-1">
              <span className="truncate text-[12px] font-medium">{group.projectName}</span>
              <span className="shrink-0 text-[11px] text-text-muted">
                {group.code === 'OK' ? (group.pulls.length === 0 ? 'none' : group.pulls.length) : null}
              </span>
              {/* An unreadable repository is the one row here with something to fix, so it is never silent. */}
              {group.code !== 'OK' && group.code !== 'NO_REMOTE' ? (
                <span className="shrink-0" title={group.reason ?? undefined}>
                  <AlertTriangle size={11} className="text-warn" />
                </span>
              ) : null}
            </p>

            {group.pulls.map((pull) => {
              const active =
                selection.kind === 'pull' &&
                selection.projectId === group.projectId &&
                selection.number === pull.number;
              return (
                <button
                  key={pull.number}
                  type="button"
                  onClick={() => onSelect({ kind: 'pull', projectId: group.projectId, number: pull.number })}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-1.5 text-left',
                    'transition-colors duration-(--duration-fast) hover:bg-surface-2',
                    active && 'bg-accent-subtle'
                  )}
                >
                  <span className="tabular mt-0.5 shrink-0 font-mono text-[11px] text-text-muted">
                    #{pull.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] leading-5">{pull.title}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
                      <span className="truncate">{pull.author}</span>
                      {pull.reviewDecision === 'CHANGES_REQUESTED' ? (
                        <span className="shrink-0 text-warn">changes</span>
                      ) : null}
                      {pull.isDraft ? <span className="shrink-0">draft</span> : null}
                      {pull.updatedAt ? (
                        <span className="shrink-0">{relativeTime(pull.updatedAt)}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {groups && total === 0 ? (
          <p className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-text-muted">
            <GitPullRequest size={12} />
            Nothing open anywhere.
          </p>
        ) : null}
      </div>
    </nav>
  );
}
