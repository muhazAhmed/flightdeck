import { useState } from 'react';
import { AlertTriangle, ChevronRight, CircleDot, FileText, Info } from 'lucide-react';
import type { ReviewFinding, ReviewResult } from '@shared/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

/**
 * A finished review: what it concluded, and each thing it raised.
 *
 * Shared by the branch reviewer and the pull-request reviewer, because a finding is a finding — the only
 * difference between them is what was read to produce it.
 */
export function FindingList({ result, onDismiss }: { result: ReviewResult; onDismiss?: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-text-secondary">
          {result.summary ?? 'The review returned no summary.'}
        </p>
        <span className="flex shrink-0 items-center gap-2 text-[11.5px] text-text-muted">
          {result.costUsd !== null ? <span className="tabular">${result.costUsd.toFixed(2)}</span> : null}
          <span>{relativeTime(result.finishedAt)} ago</span>
          {onDismiss ? (
            <button type="button" onClick={onDismiss} className="hover:text-text-primary">
              dismiss
            </button>
          ) : null}
        </span>
      </div>

      {result.error ? (
        <p className="rounded bg-danger/10 px-2 py-1.5 text-[12.5px] leading-4 text-danger">{result.error}</p>
      ) : null}

      {result.findings.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          {result.parsed ? 'Nothing to raise.' : 'The reply could not be read as findings — it is below, verbatim.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {result.findings.map((finding, index) => (
            <FindingRow key={`${finding.file}:${finding.line}:${index}`} finding={finding} />
          ))}
        </ul>
      )}

      {/* A reply we could not parse is shown rather than swallowed: an empty list would read as a clean review,
          which is the one wrong answer this feature can give. */}
      {!result.parsed && result.raw ? (
        <pre className="max-h-64 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11.5px] whitespace-pre-wrap text-text-secondary">
          {result.raw}
        </pre>
      ) : null}
    </div>
  );
}

const TONE: Record<ReviewFinding['severity'], { row: string; icon: string }> = {
  high: { row: 'border-danger/40', icon: 'text-danger' },
  medium: { row: 'border-warn/40', icon: 'text-warn' },
  low: { row: 'border-border-subtle', icon: 'text-text-muted' }
};

const ICON: Record<ReviewFinding['severity'], typeof AlertTriangle> = {
  high: AlertTriangle,
  medium: CircleDot,
  low: Info
};

/**
 * Collapsed to its claim, expanded to the reasoning. Twelve findings should be scannable in one screen.
 *
 * Exported so a test can render a real finding rather than a hand-made stand-in — the panel around it fetches
 * on mount, and a test that rebuilds the markup it means to check is a test of nothing.
 */
export function FindingRow({ finding }: { finding: ReviewFinding }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[finding.severity];
  const Icon = ICON[finding.severity];

  return (
    <li className={cn('rounded-md border bg-surface-2', tone.row)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <Icon size={13} className={cn('mt-0.5 shrink-0', tone.icon)} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-5">{finding.title}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-text-muted">
            <FileText size={10} className="shrink-0" />
            <span className="truncate font-mono">
              {finding.file}
              {finding.line !== null ? `:${finding.line}` : ''}
            </span>
          </span>
        </span>
        <ChevronRight
          size={13}
          className={cn('mt-0.5 shrink-0 text-text-muted transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && finding.detail ? (
        <p className="border-t border-border-subtle px-2.5 py-2 text-[12.5px] leading-5 text-text-secondary">
          {finding.detail}
        </p>
      ) : null}
    </li>
  );
}
