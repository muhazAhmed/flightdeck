import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronRight, CircleAlert, CircleCheck, Loader } from 'lucide-react';
import { ToolCard } from '@/features/chat/ToolCard';
import { Markdown } from '@/features/chat/Markdown';
import { cn } from '@/lib/cn';
import type { AgentLane } from './foldTask';

/**
 * One specialist: who it is, what it was asked, what it is doing, and what it reported.
 *
 * Collapsed by default to a single line, because a task with three specialists should read as three lines of
 * status — and opened, it holds everything needed to check the work: the brief the lead wrote, every tool
 * call, and the report that went back.
 */
export function AgentLaneCard({ lane, roleName }: { lane: AgentLane; roleName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'overflow-hidden rounded-md border bg-surface-2',
          lane.status === 'failed' ? 'border-danger/50' : 'border-border-subtle'
        )}
      >
        <Collapsible.Trigger className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-surface-3">
          <ChevronRight
            size={13}
            className={cn('shrink-0 text-text-muted transition-transform duration-(--duration-fast)', open && 'rotate-90')}
          />
          <span className="shrink-0 text-[13px] font-medium text-text-primary">{roleName}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary">
            {lane.status === 'running' && lane.progress ? lane.progress : lane.description}
          </span>
          <span className="tabular shrink-0 text-[11.5px] text-text-muted">
            {lane.toolUses > 0 ? `${lane.toolUses} tool ${lane.toolUses === 1 ? 'call' : 'calls'}` : null}
          </span>
          {lane.status === 'running' ? (
            <Loader size={13} className="shrink-0 animate-spin text-accent-bright" />
          ) : lane.status === 'failed' ? (
            <CircleAlert size={13} className="shrink-0 text-danger" />
          ) : (
            <CircleCheck size={13} className="shrink-0 text-success" />
          )}
        </Collapsible.Trigger>

        <Collapsible.Content className="border-t border-border-subtle">
          <div className="flex flex-col gap-3 px-3 py-3">
            {lane.prompt ? (
              <div>
                <p className="mb-1 text-[11.5px] font-medium tracking-wide text-text-muted uppercase">Brief</p>
                <p className="text-[13px] leading-5 whitespace-pre-wrap text-text-secondary">{lane.prompt}</p>
              </div>
            ) : null}

            {lane.tools.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11.5px] font-medium tracking-wide text-text-muted uppercase">Activity</p>
                {lane.tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            ) : null}

            {lane.summary ? (
              <div>
                <p className="mb-1 text-[11.5px] font-medium tracking-wide text-text-muted uppercase">
                  Report to the lead
                </p>
                <Markdown>{lane.summary}</Markdown>
              </div>
            ) : lane.status === 'running' ? (
              <p className="text-[12.5px] text-text-muted">Still working — its report appears here when it finishes.</p>
            ) : null}
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
