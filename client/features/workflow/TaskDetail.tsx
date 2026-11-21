import { useLayoutEffect, useRef, useState } from 'react';
import { GitCompare, RotateCw, Send, SlidersHorizontal, Square, Trash2 } from 'lucide-react';
import type { Project } from '@shared/types';
import type { AgentRole, TaskSummary } from '@shared/workflow';
import { Markdown } from '@/features/chat/Markdown';
import { ToolCard } from '@/features/chat/ToolCard';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { duration } from '@/lib/format';
import { AgentLaneCard } from './AgentLaneCard';
import { isDelegation } from './foldTask';
import { TaskRail } from './TaskRail';
import { taskStatusLabel, taskStatusTone } from './taskStatus';
import { useTaskStream } from './useTaskStream';

interface TaskDetailProps {
  task: TaskSummary;
  project: Project | null;
  roles: AgentRole[];
  onMessage: (text: string) => Promise<boolean>;
  onStop: () => void;
  onDelete: () => void;
  /** Open the task's project in the workspace, where its diff is. */
  onReview: () => void;
  onOpenSetup: () => void;
  /** The run ended while this was watching; the list needs the new status. */
  onEnded: () => void;
}

/** What "continue" sends. Words, not a flag: resuming is just another message to the lead's session. */
const CONTINUE = 'Continue the task from where it stopped. Re-check the current state of the working tree first.';

/**
 * One task: what was asked, who is doing what, the evidence, and the report.
 *
 * Laid out so the question "can I trust this?" is answerable without scrolling a transcript: the rail on the
 * right is counted from what actually ran, the lanes show each specialist's brief and report, and the lead's
 * own transcript is underneath for when the summary is not enough.
 */
export function TaskDetail({
  task,
  project,
  roles,
  onMessage,
  onStop,
  onDelete,
  onReview,
  onOpenSetup,
  onEnded
}: TaskDetailProps) {
  const { view, loading } = useTaskStream(task.id, task.runs, onEnded);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Follow the activity, but stop the moment the user scrolls up to read — same rule as the chat.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pinnedToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [view.blocks, view.agents]);

  const roleName = (role: string) =>
    role === 'lead' ? 'Lead' : (roles.find((candidate) => candidate.id === role)?.name ?? role);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    setSending(true);
    const sent = await onMessage(text.trim());
    setSending(false);
    if (sent) setDraft('');
  }

  const interrupted = !task.running && task.status !== 'done';
  const totals = [
    view.totals.turns > 0 ? `${view.totals.turns} turns` : null,
    view.totals.durationMs > 0 ? duration(view.totals.durationMs) : null,
    // Notional API-equivalent cost, not money billed on a subscription — see API.md.
    view.totals.costUsd > 0 ? `~$${view.totals.costUsd.toFixed(3)}` : null
  ].filter(Boolean);

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-1">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14.5px] font-semibold tracking-tight" title={task.title}>
            {task.title}
          </h2>
          <p className="flex items-center gap-2 truncate text-[12px] text-text-muted">
            <span className={cn('flex shrink-0 items-center gap-1.5', taskStatusTone(task))}>
              <span className={cn('size-1.5 rounded-full bg-current', task.running && 'animate-pulse')} />
              {task.running ? `Running · ${view.stage}` : taskStatusLabel(task)}
            </span>
            <span className="truncate">{project?.name ?? 'Project removed'}</span>
            {view.model ? <span className="truncate font-mono">{view.model}</span> : null}
            {totals.length > 0 ? <span className="tabular shrink-0">{totals.join(' · ')}</span> : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onOpenSetup} title="Allowed commands and project notes">
            <SlidersHorizontal size={12} />
            Setup
          </Button>
          <Button size="sm" onClick={onReview} disabled={!project} title="Open this project's diff in the workspace">
            <GitCompare size={12} />
            Review changes
          </Button>
          {task.running ? (
            <Button size="sm" variant="danger" onClick={onStop}>
              <Square size={11} />
              Stop
            </Button>
          ) : (
            <>
              {interrupted ? (
                <Button size="sm" disabled={sending || !project} onClick={() => void send(CONTINUE)}>
                  <RotateCw size={12} />
                  Continue
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                title="Delete this task"
                onClick={() =>
                  setConfirm({
                    title: `Delete "${task.title}"?`,
                    description:
                      'Removes the task and its activity log from Flight Deck. Nothing in the repository is touched — whatever it changed stays in the working tree for you to keep or discard.',
                    files: [task.title],
                    confirmLabel: 'Delete task',
                    tone: 'danger',
                    onConfirm: onDelete
                  })
                }
              >
                <Trash2 size={12} />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scroller}
            onScroll={(event) => {
              const el = event.currentTarget;
              pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {loading && view.blocks.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-text-muted">Loading activity…</p>
              ) : null}

              {view.agents.length > 0 ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-[11.5px] font-medium tracking-wide text-text-muted uppercase">
                    Specialists <span className="tabular normal-case">{view.agents.length}</span>
                  </h3>
                  {view.agents.map((lane) => (
                    <AgentLaneCard key={lane.id} lane={lane} roleName={roleName(lane.role)} />
                  ))}
                </section>
              ) : null}

              <h3 className="text-[11.5px] font-medium tracking-wide text-text-muted uppercase">Lead Engineer</h3>
              {view.blocks.map((block) => {
                if (block.kind === 'prompt') {
                  return (
                    <div
                      key={block.id}
                      className="max-w-[85%] self-end rounded-lg border border-border-subtle bg-surface-3 px-3 py-2 text-[14px] leading-[1.6] whitespace-pre-wrap"
                    >
                      {block.text}
                    </div>
                  );
                }
                if (block.kind === 'tool') {
                  // A delegation is already a lane above; a second card for the same call would be noise.
                  if (isDelegation(block.tool.name)) return null;
                  return <ToolCard key={block.id} tool={block.tool} />;
                }
                return <Markdown key={block.id}>{block.text}</Markdown>;
              })}

              {task.running ? (
                <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent-bright" />
                  Working…
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-border-subtle px-4 py-3">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <textarea
                value={draft}
                rows={2}
                spellCheck={false}
                disabled={task.running || !project}
                placeholder={
                  task.running
                    ? 'The lead is working — stop it to redirect, or wait for the report.'
                    : 'Follow up with the lead: ask for a change, a fix, or another check…'
                }
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[13.5px] leading-[1.5] placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <Button
                variant="primary"
                disabled={task.running || sending || !draft.trim() || !project}
                onClick={() => void send(draft)}
              >
                <Send size={13} />
                Send
              </Button>
            </div>
          </div>
        </div>

        <div className="hidden w-80 shrink-0 border-l border-border-subtle lg:block">
          <TaskRail view={view} running={task.running} projectPath={project?.path ?? null} roleName={roleName} />
        </div>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
