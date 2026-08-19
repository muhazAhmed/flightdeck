import { ChevronDown, ChevronRight, FileCode2, GitMerge, Tag, X } from 'lucide-react';
import type { CommitFile } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { DiffView } from './DiffView';
import { useHistory } from './useHistory';

/** Same letters the status list uses, so a file reads the same wherever you meet it. */
const STATUS_TONE: Record<string, string> = {
  A: 'text-success',
  M: 'text-warn',
  D: 'text-danger',
  R: 'text-info'
};

/**
 * What you have already committed.
 *
 * Read-only on purpose: there is no revert, reset or cherry-pick here and no route to add one to. Looking back
 * at a commit is a different act from undoing it, and the second belongs in a terminal where it is deliberate.
 *
 * Self-contained — list, commit detail and diff — so the Changes panel can swap its whole body for this rather
 * than thread three levels of selection through itself.
 */
export function HistoryPanel({ projectId, revision }: { projectId: string; revision: number }) {
  const history = useHistory(projectId, revision);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {history.loading && history.commits.length === 0 ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : history.commits.length === 0 ? (
          <EmptyState title="No commits yet" hint="The first commit you make here will show up in this list." />
        ) : (
          <>
            {history.commits.map((commit) => {
              const open = history.sha === commit.sha;
              return (
                <div key={commit.sha}>
                  <button
                    onClick={() => history.select(commit.sha)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left',
                      'transition-colors duration-(--duration-fast)',
                      open ? 'bg-accent-subtle' : 'hover:bg-surface-2'
                    )}
                  >
                    <span className="mt-0.5 shrink-0 text-text-muted">
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {commit.parents > 1 ? (
                          <span title="Merge commit" className="flex shrink-0">
                            <GitMerge size={11} className="text-info" />
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate text-[13px]">{commit.subject}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-text-muted">
                        <span className="font-mono">{commit.shortSha}</span>
                        <span className="truncate">{commit.author}</span>
                        <span className="shrink-0">{relativeTime(commit.at)}</span>
                      </span>
                      {commit.refs.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {commit.refs.map((ref) => (
                            <span
                              key={ref}
                              className="flex items-center gap-0.5 rounded border border-border-subtle px-1 font-mono text-[10.5px] text-text-secondary"
                            >
                              <Tag size={9} />
                              {ref}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>

                  {open ? <CommitBody history={history} /> : null}
                </div>
              );
            })}

            {history.hasMore ? (
              <div className="p-3">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={history.loadingMore}
                  onClick={() => void history.loadMore()}
                >
                  {history.loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {history.path && history.diff !== null ? (
        <div className="flex min-h-0 basis-1/2 flex-col border-t border-border-default">
          <div className="flex shrink-0 items-center gap-2 bg-surface-2 px-3 py-1.5">
            <FileCode2 size={13} className="shrink-0 text-text-muted" />
            <span className="truncate font-mono text-[12px]" title={history.path}>
              {history.path}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[11.5px] text-text-muted">
              {history.detail?.shortSha}
            </span>
            <IconButton label="Close the diff" icon={<X size={13} />} onClick={() => history.selectFile(null)} />
          </div>
          <DiffView diff={history.diff} />
        </div>
      ) : null}
    </div>
  );
}

/** The expanded commit: its message body, then the files it touched. */
function CommitBody({ history }: { history: ReturnType<typeof useHistory> }) {
  if (history.detail === null) {
    return (
      <div className="px-3 pb-2">
        <Skeleton className="h-16" />
      </div>
    );
  }

  const { detail } = history;
  return (
    <div className="border-b border-border-subtle bg-(--bg-base) px-3 pt-1 pb-2">
      {detail.body ? (
        // Preserved verbatim: a commit body is already formatted, and re-wrapping it loses the author's line
        // breaks along with any list or trailer they wrote.
        <pre className="mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-[12.5px] leading-5 text-text-secondary">
          {detail.body}
        </pre>
      ) : null}

      <p className="mb-1 text-[11.5px] text-text-muted">
        {detail.files.length} file{detail.files.length === 1 ? '' : 's'} · <span className="text-success">+{detail.insertions}</span>{' '}
        <span className="text-danger">−{detail.deletions}</span>
      </p>

      <ul className="flex flex-col">
        {detail.files.map((file) => (
          <li key={file.path}>
            <button
              onClick={() => history.selectFile(history.path === file.path ? null : file.path)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left',
                history.path === file.path ? 'bg-surface-3' : 'hover:bg-surface-2'
              )}
            >
              <span className={cn('w-3 shrink-0 text-center font-mono text-[11px]', STATUS_TONE[file.status] ?? 'text-text-muted')}>
                {file.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={file.from ? `${file.from} → ${file.path}` : file.path}>
                {file.path}
              </span>
              <Counts file={file} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A binary file reports no counts at all, which is different from reporting zero. */
function Counts({ file }: { file: CommitFile }) {
  if (file.insertions === 0 && file.deletions === 0) {
    return <span className="shrink-0 text-[11px] text-text-muted">bin</span>;
  }
  return (
    <span className="shrink-0 tabular text-[11px]">
      {file.insertions > 0 ? <span className="text-success">+{file.insertions}</span> : null}
      {file.deletions > 0 ? <span className="ml-1 text-danger">−{file.deletions}</span> : null}
    </span>
  );
}
