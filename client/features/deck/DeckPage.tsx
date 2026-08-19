import { LayoutGrid, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { ProjectCard } from './ProjectCard';
import { useDeck } from './useDeck';

interface DeckPageProps {
  open: boolean;
  onOpenProject: (projectId: string) => void;
  onAddProject: () => void;
  onClose: () => void;
}

/**
 * The deck: every project at once, ordered by what wants you.
 *
 * THE ONE SCREEN AN EDITOR CANNOT HAVE. A window knows about one workspace, so "which of my repos have
 * uncommitted work, and how long has it been sitting?" costs twenty windows to answer. Here it is a
 * glance, and it costs no tokens — git and the filesystem, nothing else.
 *
 * Ranked, not alphabetical: a repository with work rotting in it since Tuesday belongs above six clean
 * ones. See `attention.ts` for the ordering.
 */
export function DeckPage({ open, onOpenProject, onAddProject, onClose }: DeckPageProps) {
  const { projects, totals, readAt, loading, fetching, refresh, fetchAll } = useDeck(open);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-(--bg-base)">
      <header className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <LayoutGrid size={18} className="text-accent-bright" />
            Deck
          </h1>
          <p className="mt-1 text-[13.5px] text-text-secondary">
            {totals.count === 0
              ? 'Every project you add shows up here.'
              : summarise(totals)}
            {readAt ? <span className="text-text-muted"> · read {relativeTime(readAt)} ago</span> : null}
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-2">
          {/* Its own button, not automatic: twenty fetches is real network work, and it is the only
              way ahead/behind stops being a stale zero. */}
          <Button size="sm" variant="secondary" disabled={fetching || totals.count === 0} onClick={() => void fetchAll()}>
            <RefreshCw size={13} className={cn(fetching && 'animate-spin')} />
            {fetching ? 'Fetching all…' : 'Fetch all'}
          </Button>
          <IconButton
            label="Re-read every project"
            icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />}
            disabled={loading}
            onClick={() => void refresh()}
          />
          <IconButton label="Close the deck" icon={<X size={16} />} onClick={onClose} />
        </span>
      </header>

      <div className="min-h-0 flex-1 px-6 pb-8">
        {loading && projects.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <Skeleton key={key} className="h-32" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            hint="Add a folder that is a git repository and it appears on the deck."
            action={
              <Button size="sm" onClick={onAddProject}>
                <Plus size={13} />
                Add project
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.projectId} project={project} onOpen={onOpenProject} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One sentence of the only numbers worth leading with. */
function summarise(totals: { count: number; dirty: number; unpushed: number; behind: number; broken: number }): string {
  const parts: string[] = [];
  parts.push(`${totals.count} ${totals.count === 1 ? 'project' : 'projects'}`);
  if (totals.dirty > 0) parts.push(`${totals.dirty} with uncommitted work`);
  if (totals.unpushed > 0) parts.push(`${totals.unpushed} unpushed`);
  if (totals.behind > 0) parts.push(`${totals.behind} behind`);
  if (totals.broken > 0) parts.push(`${totals.broken} unreadable`);
  // Nothing to report is worth saying out loud.
  if (parts.length === 1) parts.push('all clean');
  return parts.join(' · ');
}
