import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Coins, Gauge, RefreshCw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectTranscriptUsage, UsageByProject, UsageReport } from '@shared/types';
import { Card } from '@/features/settings/controls/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { clockTime, relativeTime } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { ProjectUsageDetail } from './ProjectUsageDetail';
import { TranscriptCard } from './TranscriptCard';
import { usageApi } from './api';
import { money, percent, span, tokens } from './format';

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'All' }
];

interface UsagePageProps {
  open: boolean;
  onOpenProject: (projectId: string) => void;
  onOpenChat: (projectId: string, chatId: string) => void;
  onClose: () => void;
}

/**
 * Where the quota went, per project.
 *
 * The CLI reports a run's cost once and forgets it; this is the accumulation. For anyone working across
 * client repositories it answers two questions nothing else can: which project is eating the current
 * five-hour window, and what a month on a repo actually came to.
 *
 * ON THE WORD "NOTIONAL": `total_cost_usd` is what the same tokens would have cost through the API. A
 * subscription is not billed per token, so presenting it as money spent would be a lie. It is labelled
 * everywhere it appears — the honest use is comparison between projects, not a bill.
 */
export function UsagePage({ open, onOpenProject, onOpenChat, onClose }: UsagePageProps) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  /** Which project is opened up. Null is the cross-project view. */
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<ProjectTranscriptUsage[]>([]);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    try {
      setReport(await usageApi.get(range));
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load(days);
  }, [open, days, load]);

  // Independent of the range selector: a transcript has no run boundaries to filter by, and reading them
  // is the slower of the two requests, so it is not repeated when the period changes.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        setTranscripts((await usageApi.transcripts()).projects);
      } catch {
        // The page is still useful without them; the log-based figures stand on their own.
      }
    })();
  }, [open]);

  // Empty only when BOTH sources are empty. Showing "nothing recorded" while transcripts sit on disk is
  // what made this page look broken after a long conversation held outside Flight Deck.
  const empty = report !== null && report.totals.runs === 0 && transcripts.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-(--bg-base)">
      <header className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <Coins size={18} className="text-accent-bright" />
            Usage
          </h1>
          <p className="mt-1 text-[13.5px] text-text-secondary">
            Which projects your runs went to, and how much of the quota window is left.
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border-subtle bg-surface-1 p-1">
            {RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setDays(range.days)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12.5px] transition-colors duration-(--duration-fast)',
                  days === range.days
                    ? 'border border-border bg-surface-2 font-medium text-text-primary'
                    : 'border border-transparent text-text-secondary hover:text-text-primary'
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
          <IconButton
            label="Re-read the usage log"
            icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />}
            disabled={loading}
            onClick={() => void load(days)}
          />
          <IconButton label="Close usage" icon={<X size={16} />} onClick={onClose} />
        </span>
      </header>

      <div className="min-h-0 flex-1 px-6 pb-8">
        {detailFor !== null ? (
          <ProjectUsageDetail
            projectId={detailFor}
            days={days}
            transcripts={transcripts.find((p) => p.projectId === detailFor) ?? null}
            onBack={() => setDetailFor(null)}
            onOpenProject={onOpenProject}
            onOpenChat={onOpenChat}
          />
        ) : report === null ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : empty ? (
          <EmptyState
            title="Nothing recorded yet"
            hint="Every finished run is logged here — cost, tokens and which project it ran in."
          />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Runs" value={String(report.totals.runs)} hint={`${report.totals.turns} turns`} />
              <Stat
                label="Notional cost"
                value={money(report.totals.costUsd)}
                hint="API-equivalent, not billed"
              />
              <Stat label="Agent time" value={span(report.totals.durationMs)} hint="Sum of run durations" />
              <Stat
                label="Output tokens"
                value={tokens(report.totals.outputTokens)}
                hint={`${tokens(report.totals.cacheReadTokens)} read from cache`}
              />
            </div>

            <QuotaWindow report={report} />

            <Card title="By project" icon={<Coins size={14} />}>
              <ProjectTable projects={report.projects} onOpenProject={setDetailFor} />
            </Card>

            <TranscriptCard projects={transcripts} onOpenProject={setDetailFor} />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card title="By model" icon={<Sparkles size={14} />}>
                <ul className="flex flex-col">
                  {report.models.map((model) => (
                    <li
                      key={model.model}
                      className="flex items-center gap-3 border-b border-border-subtle py-2 text-[13px] last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                        {model.model.replace(/^claude-/, '')}
                      </span>
                      <span className="shrink-0 tabular text-text-muted">{model.runs} runs</span>
                      <span className="w-16 shrink-0 text-right tabular">{money(model.costUsd)}</span>
                      <span className="w-10 shrink-0 text-right tabular text-text-muted">
                        {percent(model.share)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="By day" icon={<Gauge size={14} />}>
                <DailyBars report={report} />
              </Card>
            </div>

            <p className="text-[12px] leading-5 text-text-muted">
              Cost is what these tokens would have cost through the API. On a subscription nothing here
              is billed to you — the number is useful for comparing projects, not as an invoice. Cached
              reads dominate token counts and are shown separately for that reason.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1 p-4">
      <p className="text-[12px] tracking-wide text-text-muted uppercase">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-text-muted">{hint}</p>
    </div>
  );
}

/**
 * The five-hour window.
 *
 * Bounded by the CLI's own reset time when a run has reported one; otherwise the last five hours, which
 * is said out loud rather than implied.
 */
function QuotaWindow({ report }: { report: UsageReport }) {
  const { window: quota } = report;
  return (
    <Card title="Current quota window" icon={<Gauge size={14} />}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-[13px]">
          <span className="text-text-muted">Since </span>
          {relativeTime(quota.startedAt)} ago
          {quota.resetsAt ? (
            <>
              <span className="text-text-muted"> · resets </span>
              {clockTime(quota.resetsAt)}
            </>
          ) : (
            <span className="text-text-muted"> · no reset time reported yet, so this is the last 5 hours</span>
          )}
        </span>
        <span className="text-[13px] tabular">
          <span className="text-text-muted">Runs </span>
          {quota.totals.runs}
          <span className="text-text-muted"> · </span>
          {money(quota.totals.costUsd)}
          <span className="text-text-muted"> · </span>
          {span(quota.totals.durationMs)}
        </span>
      </div>

      {quota.projects.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {quota.projects.slice(0, 5).map((project) => (
            <div key={project.projectId} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-32 shrink-0 truncate">{project.name}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(2, Math.round(project.share * 100))}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right tabular text-text-muted">{percent(project.share)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-text-muted">No runs in this window.</p>
      )}
    </Card>
  );
}

function ProjectTable({
  projects,
  onOpenProject
}: {
  projects: UsageByProject[];
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-[13px]">
        <thead>
          <tr className="text-left text-[11.5px] tracking-wide text-text-muted uppercase">
            <th className="pb-2 font-medium">Project</th>
            <th className="pb-2 text-right font-medium">Runs</th>
            <th className="pb-2 text-right font-medium">Cost</th>
            <th className="pb-2 text-right font-medium">Share</th>
            <th className="pb-2 text-right font-medium">Output</th>
            <th className="pb-2 text-right font-medium">Time</th>
            <th className="pb-2 text-right font-medium">Last run</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.projectId} className="border-t border-border-subtle">
              <td className="max-w-56 py-2">
                <button
                  onClick={() => onOpenProject(project.projectId)}
                  className="block max-w-full truncate text-left hover:text-accent-bright"
                  title={`Open ${project.name}`}
                >
                  {project.name}
                </button>
                {project.errors > 0 ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-warn">
                    <AlertTriangle size={10} />
                    {project.errors} failed
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-right tabular">{project.runs}</td>
              <td className="py-2 text-right tabular">{money(project.costUsd)}</td>
              <td className="py-2 text-right tabular text-text-muted">{percent(project.share)}</td>
              <td className="py-2 text-right tabular text-text-muted">{tokens(project.outputTokens)}</td>
              <td className="py-2 text-right tabular text-text-muted">{span(project.durationMs)}</td>
              <td className="py-2 text-right tabular text-text-muted">
                {project.lastRunAt ? relativeTime(project.lastRunAt) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bars rather than a chart library: it is one series, and a dependency for that would be absurd. */
function DailyBars({ report }: { report: UsageReport }) {
  const peak = Math.max(...report.daily.map((day) => day.costUsd), 0.0001);
  return (
    <div className="flex h-32 items-end gap-1">
      {report.daily.map((day) => (
        <div
          key={day.day}
          className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
          title={`${day.day} · ${day.runs} runs · ${money(day.costUsd)}`}
        >
          <span
            className="w-full rounded-t bg-accent transition-colors group-hover:bg-accent-bright"
            style={{ height: `${Math.max(2, Math.round((day.costUsd / peak) * 100))}%` }}
          />
          <span className="w-full truncate text-center text-[10px] text-text-muted">
            {day.day.slice(8)}
          </span>
        </div>
      ))}
    </div>
  );
}
