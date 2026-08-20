import { Loader2, ScanSearch } from 'lucide-react';
import type { Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { FindingList } from './FindingList';
import { effort } from './stream';
import { useReview } from './useReview';

/**
 * Review a project's own branch before it becomes a pull request.
 *
 * NEEDS NO GITHUB. This is git and the agent, so it works for every project — including one whose remote is
 * somewhere else, or which has no remote at all. It reads the change against the branch this project's pull
 * requests actually go to, and it counts uncommitted work, because that is the state you are about to raise a
 * pull request from whether or not you have committed it yet.
 */
export function BranchReview({ project }: { project: Project | null }) {
  const { context, result, progress, start, stop, discard } = useReview(project?.id ?? null);

  if (!project) {
    return <EmptyState title="No project selected" hint="Pick a project to review its branch." />;
  }

  const nothingToDo = context?.reason ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[17px] leading-6 font-semibold">
            <ScanSearch size={16} className="text-accent-bright" />
            {project.name}
          </h1>
          <p className="mt-1 text-[12.5px] leading-5 text-text-secondary">
            {context ? (
              nothingToDo ? (
                nothingToDo
              ) : (
                <>
                  <span className="font-mono">{context.branch ?? 'detached'}</span> against{' '}
                  <span className="font-mono">{context.baseRef ?? 'nothing'}</span> —{' '}
                  {count(context.changedFiles, 'file')} changed
                  {context.commits > 0 ? `, ${count(context.commits, 'commit')} ahead` : ''}
                  {context.uncommitted > 0 ? `, ${context.uncommitted} uncommitted` : ''}
                </>
              )
            ) : (
              'Reading the repository…'
            )}
          </p>
        </div>

        {progress.running ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <Loader2 size={12} className="animate-spin" />
              {progress.activity}
              {effort(progress) ? ` · ${effort(progress)}` : ''}
            </span>
            <Button size="sm" variant="secondary" onClick={stop}>
              Stop
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="primary" disabled={nothingToDo !== null} onClick={() => void start()}>
            <ScanSearch size={13} />
            {result ? 'Review again' : 'Review'}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 px-5 py-4">
        {result ? (
          <FindingList result={result} onDismiss={() => void discard()} />
        ) : (
          <p className="text-[12.5px] leading-5 text-text-muted">
            {/* The promise that matters, before the button is pressed. */}
            Reads the diff against {context?.baseRef ?? 'the base branch'} and the files around it, committed and
            uncommitted alike. It cannot edit anything — the run is in the CLI's plan mode.
          </p>
        )}
      </div>
    </div>
  );
}

function count(value: number, noun: string): string {
  return `${value} ${value === 1 ? noun : `${noun}s`}`;
}
