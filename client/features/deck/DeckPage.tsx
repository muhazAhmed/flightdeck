import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowDownWideNarrow, Check, ChevronDown, LayoutGrid, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { ProjectOverview } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { ProjectCard } from './ProjectCard';
import { FILTERS, SORTS, type SortId } from './filter';
import { useDeck } from './useDeck';

interface DeckPageProps {
  open: boolean;
  onOpenProject: (projectId: string) => void;
  /** Open a project with its terminal showing — from a card, so "go run something there" is one click. */
  onOpenTerminal: (projectId: string) => void;
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
 * ones. See `attention.ts` for the ordering and `filter.ts` for narrowing it.
 */
export function DeckPage({ open, onOpenProject, onOpenTerminal, onAddProject, onClose }: DeckPageProps) {
  const {
    projects,
    counts,
    totals,
    readAt,
    loading,
    fetching,
    query,
    setQuery,
    filter,
    setFilter,
    sort,
    setSort,
    refresh,
    fetchAll,
    stopShell
  } = useDeck(open);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const narrowed = query.trim() !== '' || filter !== 'all';

  const askToStop = (project: ProjectOverview) =>
    setConfirm({
      title: `Stop the shell in ${project.name}?`,
      description:
        'Kills the shell and anything running in it, including a dev server. This project stays where it is — only the shell goes.',
      files: [project.path],
      confirmLabel: 'Stop shell',
      tone: 'danger',
      onConfirm: () => void stopShell(project.projectId)
    });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-(--bg-base)">
      <header className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <LayoutGrid size={18} className="text-accent-bright" />
            Deck
          </h1>
          <p className="mt-1 text-[13.5px] text-text-secondary">
            {totals.count === 0 ? 'Every project you add shows up here.' : summarise(totals)}
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

      {/* Hidden while there is nothing to narrow: a filter bar above two cards is furniture. */}
      {totals.count > 1 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-4">
          <span className="flex h-7 min-w-48 items-center gap-2 rounded-md border border-border-default bg-surface-2 px-2">
            <Search size={12} className="shrink-0 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or path…"
              spellCheck={false}
              aria-label="Filter projects"
              className="w-full bg-transparent text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            {query !== '' ? (
              <IconButton label="Clear the filter" icon={<X size={12} />} onClick={() => setQuery('')} />
            ) : null}
          </span>

          {/* Chips carry their count, so you can see there is nothing behind before pressing it. A chip
              whose answer is zero is shown disabled rather than hidden — a row that reshuffles as repos
              change state is harder to aim at than one with a dead key in it. */}
          {FILTERS.map((spec) => {
            const count = counts[spec.id];
            return (
              <button
                key={spec.id}
                type="button"
                title={spec.hint}
                aria-pressed={filter === spec.id}
                disabled={count === 0 && spec.id !== 'all'}
                onClick={() => setFilter(spec.id)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px]',
                  'transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-40',
                  filter === spec.id
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3'
                )}
              >
                {spec.label}
                <span className="tabular text-text-muted">{count}</span>
              </button>
            );
          })}

          <span className="ml-auto flex items-center gap-2">
            {narrowed ? (
              <span className="tabular text-[12px] text-text-muted">
                {projects.length} of {totals.count}
              </span>
            ) : null}
            <SortMenu sort={sort} onSelect={setSort} />
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 px-6 pb-8">
        {loading && projects.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <Skeleton key={key} className="h-32" />
            ))}
          </div>
        ) : totals.count === 0 ? (
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
        ) : projects.length === 0 ? (
          // Distinct from having no projects at all, so an over-narrow filter never reads as an empty deck.
          <EmptyState
            title="Nothing matches"
            hint="No project matches this filter and search."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Show every project
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.projectId}
                project={project}
                onOpen={onOpenProject}
                onOpenTerminal={onOpenTerminal}
                onStopShell={askToStop}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** Which "first" you meant. A menu rather than a row of buttons: only one is ever in force. */
function SortMenu({ sort, onSelect }: { sort: SortId; onSelect: (sort: SortId) => void }) {
  const current = SORTS.find((spec) => spec.id === sort) ?? SORTS[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Sort the deck"
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 text-[12.5px] hover:bg-surface-3"
      >
        <ArrowDownWideNarrow size={12} className="shrink-0 text-text-muted" />
        <span className="truncate">{current?.label}</span>
        <ChevronDown size={11} className="shrink-0 text-text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
        >
          {SORTS.map((spec) => (
            <DropdownMenu.Item
              key={spec.id}
              onSelect={() => onSelect(spec.id)}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
            >
              <Check size={13} className={cn('mt-0.5 shrink-0', spec.id === sort ? 'text-accent-bright' : 'opacity-0')} />
              <span className="min-w-0">
                <span className="block text-[13px]">{spec.label}</span>
                <span className="block text-[11.5px] leading-4 text-text-muted">{spec.hint}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One sentence of the only numbers worth leading with. */
function summarise(totals: {
  count: number;
  dirty: number;
  unpushed: number;
  behind: number;
  broken: number;
  shells: number;
}): string {
  const parts: string[] = [];
  parts.push(`${totals.count} ${totals.count === 1 ? 'project' : 'projects'}`);
  if (totals.dirty > 0) parts.push(`${totals.dirty} with uncommitted work`);
  if (totals.unpushed > 0) parts.push(`${totals.unpushed} unpushed`);
  if (totals.behind > 0) parts.push(`${totals.behind} behind`);
  // Said here because a shell you forgot is holding a port, and nothing else in the app mentions it.
  if (totals.shells > 0) parts.push(`${totals.shells} ${totals.shells === 1 ? 'shell' : 'shells'} running`);
  if (totals.broken > 0) parts.push(`${totals.broken} unreadable`);
  // Nothing to report is worth saying out loud.
  if (parts.length === 1) parts.push('all clean');
  return parts.join(' · ');
}
