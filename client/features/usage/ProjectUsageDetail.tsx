import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ExternalLink, Gauge, MessageSquare, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectUsageReport } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/features/settings/controls/Card';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { detailOf, messageOf } from '@/lib/http';
import { usageApi } from './api';
import { money, percent, span, tokens } from './format';

interface ProjectUsageDetailProps {
  projectId: string;
  days: number;
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenChat: (projectId: string, chatId: string) => void;
}

/** Local date and time for a run row. A run is a moment, so the wall clock is what you recognise. */
function stamp(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${at.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

/**
 * One project's usage, run by run.
 *
 * The row-level view exists because a total answers "how much" and nothing else. When a project's cost
 * looks wrong, the question is immediately *which run*, and then *which conversation* — so every run is
 * listed with its model, turns, duration and tokens, and the chat that produced it opens in one click.
 */
export function ProjectUsageDetail({
  projectId,
  days,
  onBack,
  onOpenProject,
  onOpenChat
}: ProjectUsageDetailProps) {
  const [report, setReport] = useState<ProjectUsageReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await usageApi.project(projectId, days));
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && report === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (report === null) return null;

  const { totals } = report;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={onBack}>
          <ArrowLeft size={13} />
          All projects
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight">{report.name}</h2>
        <Button size="sm" variant="secondary" onClick={() => onOpenProject(projectId)}>
          <ExternalLink size={13} />
          Open project
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Figure label="Runs" value={String(totals.runs)} hint={`${totals.turns} turns`} />
        <Figure label="Notional cost" value={money(totals.costUsd)} hint="API-equivalent" />
        <Figure label="Agent time" value={span(totals.durationMs)} hint="Sum of durations" />
        <Figure
          label="Tokens out"
          value={tokens(totals.outputTokens)}
          hint={`${tokens(totals.inputTokens)} in`}
        />
        <Figure
          label="Cache"
          value={tokens(totals.cacheReadTokens)}
          hint={`${tokens(totals.cacheCreationTokens)} written`}
        />
      </div>

      {totals.errors > 0 ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-warn">
          <AlertTriangle size={12} />
          {totals.errors} of {totals.runs} runs ended in an error — they still spent quota.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Models used here" icon={<Sparkles size={14} />}>
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
                <span className="w-10 shrink-0 text-right tabular text-text-muted">{percent(model.share)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Most expensive chats" icon={<MessageSquare size={14} />}>
          {report.chats.length === 0 ? (
            <p className="text-[13px] text-text-muted">No runs in this period.</p>
          ) : (
            <ul className="flex flex-col">
              {report.chats.slice(0, 6).map((chat) => (
                <li
                  key={chat.chatId}
                  className="flex items-center gap-3 border-b border-border-subtle py-2 text-[13px] last:border-b-0"
                >
                  <button
                    onClick={() => onOpenChat(projectId, chat.chatId)}
                    className="min-w-0 flex-1 truncate text-left hover:text-accent-bright"
                    title={`Open "${chat.title}"`}
                  >
                    {chat.title}
                  </button>
                  <span className="shrink-0 tabular text-text-muted">{chat.runs}×</span>
                  <span className="w-16 shrink-0 text-right tabular">{money(chat.costUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Runs${report.omittedRuns > 0 ? ` (newest ${report.runs.length})` : ''}`} icon={<Gauge size={14} />}>
        {report.runs.length === 0 ? (
          <p className="text-[13px] text-text-muted">Nothing recorded for this project in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] tracking-wide text-text-muted uppercase">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Chat</th>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 text-right font-medium">Turns</th>
                  <th className="pb-2 text-right font-medium">Time</th>
                  <th className="pb-2 text-right font-medium">Out</th>
                  <th className="pb-2 text-right font-medium">Cache</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {report.runs.map((run) => (
                  <tr key={`${run.at}-${run.chatId}`} className="border-t border-border-subtle">
                    <td className="py-2 whitespace-nowrap tabular text-text-secondary" title={run.at}>
                      {stamp(run.at)}
                    </td>
                    <td className="max-w-48 py-2">
                      <button
                        onClick={() => onOpenChat(projectId, run.chatId)}
                        className="flex max-w-full items-center gap-1.5 truncate text-left hover:text-accent-bright"
                        title={`Open "${run.chatTitle}"`}
                      >
                        {run.isError ? <AlertTriangle size={11} className="shrink-0 text-warn" /> : null}
                        <span className="truncate">{run.chatTitle}</span>
                      </button>
                    </td>
                    <td className="py-2 font-mono text-[12px] text-text-muted">
                      {(run.model ?? 'unknown').replace(/^claude-/, '')}
                    </td>
                    <td className="py-2 text-right tabular">{run.numTurns}</td>
                    <td className="py-2 text-right tabular text-text-muted">{span(run.durationMs)}</td>
                    <td className="py-2 text-right tabular text-text-muted">{tokens(run.outputTokens)}</td>
                    <td
                      className="py-2 text-right tabular text-text-muted"
                      title={`${run.cacheReadTokens} read · ${run.cacheCreationTokens} written`}
                    >
                      {tokens(run.cacheReadTokens)}
                    </td>
                    <td className={cn('py-2 text-right tabular', run.costUsd > 0 && 'font-medium')}>
                      {money(run.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Said out loud: a silently truncated table reads as "that is all there was". */}
        {report.omittedRuns > 0 ? (
          <p className="mt-3 text-[12px] text-text-muted">
            {report.omittedRuns} older {report.omittedRuns === 1 ? 'run is' : 'runs are'} not listed. The
            totals above include {report.omittedRuns === 1 ? 'it' : 'them'}.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-1 p-3">
      <p className="text-[11.5px] tracking-wide text-text-muted uppercase">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold tabular tracking-tight">{value}</p>
      <p className="text-[11px] text-text-muted">{hint}</p>
    </div>
  );
}
