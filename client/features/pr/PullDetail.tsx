import { useState } from 'react';
import { ExternalLink, FileDiff, Loader2, ScanSearch } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';
import { DiffView } from '@/features/changes/DiffView';
import { FindingList } from '@/features/review/FindingList';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { effort } from '@/features/review/stream';
import { usePullReview } from './usePullReview';

/**
 * One pull request: what it is, what it changes, and what a review of it found.
 *
 * The diff goes straight into the same viewer the Changes panel uses — word-level highlighting and all — which
 * is most of this arriving for free.
 *
 * Reviewing it is the same run as a branch review against a different revision. The server fetches the pull
 * request's commit into a ref first, so the agent reads whole files as *it* leaves them: your working copy of a
 * file it changed is a different file, and reviewing against the wrong one produces confident nonsense.
 */
export function PullDetail({ projectId, number }: { projectId: string; number: number }) {
  const { detail, loading, result, progress, start, stop } = usePullReview(projectId, number);
  const [showDiff, setShowDiff] = useState(true);

  if (loading && !detail) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!detail) {
    return <EmptyState title="Could not read this pull request" hint="It may have been closed, or renamed." />;
  }

  const { pull } = detail;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex shrink-0 flex-wrap items-start gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] leading-6 font-semibold">
            <span className="tabular mr-1.5 font-mono text-[14px] text-text-muted">#{pull.number}</span>
            {pull.title}
            {pull.isDraft ? <span className="ml-2 text-[12px] text-text-muted">draft</span> : null}
          </h1>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
            <span>{pull.author}</span>
            <span className="font-mono">
              {pull.head} → {pull.base}
            </span>
            <span className="flex items-center gap-1">
              <FileDiff size={11} />
              {pull.changedFiles}
              <span className="text-success">+{pull.additions}</span>
              <span className="text-danger">−{pull.deletions}</span>
            </span>
            {pull.reviewDecision === 'CHANGES_REQUESTED' ? (
              <span className="text-warn">changes requested</span>
            ) : null}
            {pull.updatedAt ? <span>{relativeTime(pull.updatedAt)} ago</span> : null}
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => window.open(pull.url, '_blank', 'noreferrer')}>
            <ExternalLink size={12} />
            GitHub
          </Button>
          {progress.running ? (
            <>
              <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <Loader2 size={12} className="animate-spin" />
                {progress.activity}
                {effort(progress) ? ` · ${effort(progress)}` : ''}
              </span>
              <Button size="sm" variant="secondary" onClick={stop}>
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void start()}>
              <ScanSearch size={13} />
              {result ? 'Review again' : 'Review'}
            </Button>
          )}
        </span>
      </header>

      {result ? (
        <section className="shrink-0 border-b border-border-subtle px-5 py-4">
          <FindingList result={result} />
        </section>
      ) : (
        <p className="shrink-0 px-5 py-3 text-[12px] text-text-muted">
          {/* Said before it is pressed, because it costs tokens and reads someone else's code. */}
          Reviewing fetches this pull request's commit into a private ref and reads the files as it leaves them.
          Nothing is checked out, and your working tree is not touched.
        </p>
      )}

      <div className="min-h-0 flex-1 px-5 pb-6">
        <button
          type="button"
          onClick={() => setShowDiff((value) => !value)}
          className="mb-2 text-[12px] text-text-muted hover:text-text-primary"
        >
          {showDiff ? 'Hide' : 'Show'} the diff
          {detail.files.length > 0 ? ` (${detail.files.length} files)` : ''}
        </button>

        {detail.reason ? (
          <p className="rounded bg-warn/10 px-2 py-1.5 text-[12.5px] text-warn">{detail.reason}</p>
        ) : null}

        {showDiff && detail.diff ? (
          <div className={cn('overflow-x-auto rounded-md border border-border-subtle')}>
            <DiffView diff={detail.diff} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
