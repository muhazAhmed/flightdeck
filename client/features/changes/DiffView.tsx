import { useMemo } from 'react';
import type { DiffHunk } from '@shared/types';
import { cn } from '@/lib/cn';
import { countLines, diffStats, parseDiff } from './parseDiff';

interface DiffViewProps {
  diff: string;
  /** Guards the browser against a generated-file diff with 50k lines. */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 4000;

const ROW_STYLES: Record<DiffHunk['lines'][number]['kind'], string> = {
  add: 'bg-[var(--diff-add-bg)]',
  del: 'bg-[var(--diff-del-bg)]',
  context: '',
  meta: 'text-text-muted italic'
};

const MARKERS: Record<DiffHunk['lines'][number]['kind'], string> = {
  add: '+',
  del: '-',
  context: ' ',
  meta: ' '
};

export function DiffView({ diff, maxLines = DEFAULT_MAX_LINES }: DiffViewProps) {
  const hunks = useMemo(() => parseDiff(diff), [diff]);
  const stats = useMemo(() => diffStats(hunks), [hunks]);
  const total = useMemo(() => countLines(hunks), [hunks]);

  if (hunks.length === 0) {
    return <p className="px-3 py-4 text-[12.5px] text-text-muted">No textual changes to show.</p>;
  }

  // Truncating is a last resort, but it must be visible: a silently shortened diff would
  // let someone commit a change they think they reviewed.
  const truncated = total > maxLines;
  const shown = truncated ? limitLines(hunks, maxLines) : hunks;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-1.5 text-[12.5px]">
        <span className="tabular text-[color:var(--diff-add-gutter)]">+{stats.additions}</span>
        <span className="tabular text-[color:var(--diff-del-gutter)]">−{stats.deletions}</span>
        {truncated ? (
          <span className="ml-auto text-warn">
            showing first <span className="tabular">{maxLines}</span> of{' '}
            <span className="tabular">{total}</span> lines
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-[18px]">
        {shown.map((hunk) => (
          <div key={hunk.header}>
            <div className="sticky top-0 bg-surface-2 px-3 py-0.5 text-text-muted">{hunk.header}</div>
            {hunk.lines.map((line, index) => (
              <div
                key={`${hunk.header}-${index}`}
                className={cn('flex whitespace-pre', ROW_STYLES[line.kind])}
              >
                <span className="tabular w-10 shrink-0 pr-2 text-right text-text-muted select-none">
                  {line.oldNumber ?? ''}
                </span>
                <span className="tabular w-10 shrink-0 pr-2 text-right text-text-muted select-none">
                  {line.newNumber ?? ''}
                </span>
                <span
                  className={cn(
                    'w-4 shrink-0 select-none',
                    line.kind === 'add' && 'text-[color:var(--diff-add-gutter)]',
                    line.kind === 'del' && 'text-[color:var(--diff-del-gutter)]'
                  )}
                >
                  {MARKERS[line.kind]}
                </span>
                <span className="min-w-0 flex-1 text-text-primary">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Keep whole hunks where possible, so a truncated diff still reads as diff rather than
 *  stopping mid-hunk with no header context. */
function limitLines(hunks: DiffHunk[], budget: number): DiffHunk[] {
  const out: DiffHunk[] = [];
  let used = 0;
  for (const hunk of hunks) {
    if (used >= budget) break;
    const room = budget - used;
    if (hunk.lines.length <= room) {
      out.push(hunk);
      used += hunk.lines.length + 1;
    } else {
      out.push({ ...hunk, lines: hunk.lines.slice(0, room) });
      break;
    }
  }
  return out;
}
