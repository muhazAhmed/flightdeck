import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Gauge, Plus } from 'lucide-react';
import type { Chat, PermissionMode, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { cn } from '@/lib/cn';
import { clockTime, duration } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { chatsApi } from './api';
import { PromptInput } from './PromptInput';
import { ToolCard } from './ToolCard';
import { useChatStream } from './useChatStream';

interface ChatPanelProps {
  project: Project | null;
  chat: Chat | null;
  onCreateChat: () => void;
  onChatChanged: (chat: Chat) => void;
  onRunStateChange: (running: boolean) => void;
}

const MODES: PermissionMode[] = ['acceptEdits', 'plan', 'bypassPermissions'];

const MODE_LABELS: Record<PermissionMode, string> = {
  acceptEdits: 'accept edits',
  plan: 'plan only',
  bypassPermissions: 'bypass all'
};

export function ChatPanel({ project, chat, onCreateChat, onChatChanged, onRunStateChange }: ChatPanelProps) {
  const { blocks, running, error, summary, rateLimit, send, stop, hydrate } = useChatStream(chat?.id ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const [replaying, setReplaying] = useState(false);

  // Replay past messages when a chat is opened. The CLI owns the transcript, so this is a
  // read of its file rather than anything Flight Deck stored — see DECISIONS.md. A chat
  // that has never run simply replays nothing.
  useEffect(() => {
    if (!chat) return;
    let cancelled = false;
    setReplaying(true);
    void (async () => {
      try {
        const events = await chatsApi.history(chat.id);
        if (!cancelled && events.length > 0) hydrate(events);
      } catch (err) {
        // Losing history is not worth blocking the chat over; the user can still talk.
        if (!cancelled) toast.error(messageOf(err), { description: detailOf(err) });
      } finally {
        if (!cancelled) setReplaying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chat?.id, hydrate]);

  useEffect(() => {
    onRunStateChange(running);
  }, [running, onRunStateChange]);

  // Follow the stream, but stop following the moment the user scrolls up to read
  // something — yanking the viewport back down mid-read is the worst chat-UI sin.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pinnedToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [blocks]);

  useEffect(() => {
    if (!error) return;
    toast.error(error.message, { description: error.detail, duration: Infinity });
  }, [error]);

  if (!project) {
    return (
      <EmptyState
        title="No project selected"
        hint="Add a repository from the sidebar, or press Ctrl+K to jump to one you already added."
      />
    );
  }

  if (!chat) {
    return (
      <EmptyState
        title={`No chat open for ${project.name}`}
        hint="Each chat keeps its own conversation and context for this repository."
        action={
          <Button variant="primary" onClick={onCreateChat}>
            <Plus size={14} /> New chat
          </Button>
        }
      />
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-surface-1">
      <ChatHeader chat={chat} project={project} rateLimit={rateLimit} onChatChanged={onChatChanged} />

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex-1 overflow-y-auto px-3 py-3"
      >
        {replaying && blocks.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-text-muted">Loading history…</p>
        ) : null}

        {blocks.length === 0 && !running && !replaying ? (
          <p className="py-8 text-center text-[12.5px] text-text-muted">
            Ask for a change, a review, or an explanation. Files are edited in{' '}
            <span className="font-mono">{project.name}</span> and nothing is committed for you.
          </p>
        ) : null}

        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {blocks.map((block) => {
            if (block.kind === 'prompt') {
              return (
                <div key={block.id} className="self-end rounded-md bg-surface-3 px-3 py-2 whitespace-pre-wrap">
                  {block.text}
                </div>
              );
            }
            if (block.kind === 'tool') return <ToolCard key={block.id} tool={block.tool} />;
            return (
              <div key={block.id} className="whitespace-pre-wrap text-text-primary">
                {block.text}
              </div>
            );
          })}

          {running ? (
            <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
              <span className="size-1.5 animate-pulse rounded-full bg-accent-bright" />
              Working…
            </div>
          ) : null}

          {summary ? <RunSummaryLine summary={summary} /> : null}
        </div>
      </div>

      <PromptInput running={running} onSend={send} onStop={stop} />
    </section>
  );
}

function ChatHeader({
  chat,
  project,
  rateLimit,
  onChatChanged
}: {
  chat: Chat;
  project: Project;
  rateLimit: { rateLimitType: string | null; resetsAt: number | null } | null;
  onChatChanged: (chat: Chat) => void;
}) {
  const [mode, setMode] = useState<PermissionMode>(chat.permissionMode);

  useEffect(() => setMode(chat.permissionMode), [chat.permissionMode]);

  async function changeMode(next: PermissionMode) {
    setMode(next);
    try {
      onChatChanged(await chatsApi.setMode(chat.id, next));
    } catch (err) {
      setMode(chat.permissionMode);
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }

  return (
    <header className="flex items-center gap-3 border-b border-border-subtle px-3 py-2">
      <div className="min-w-0">
        <h2 className="truncate font-medium">{chat.title}</h2>
        <p className="truncate font-mono text-[12.5px] text-text-muted">{project.path}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {rateLimit?.resetsAt ? (
          <span
            title={`${rateLimit.rateLimitType ?? 'quota'} window resets at ${clockTime(rateLimit.resetsAt)}`}
            className="flex items-center gap-1.5 rounded border border-border-subtle px-2 py-0.5 text-[12.5px] text-text-secondary"
          >
            <Gauge size={12} />
            <span className="tabular">{clockTime(rateLimit.resetsAt)}</span>
          </span>
        ) : null}

        <select
          value={mode}
          onChange={(event) => void changeMode(event.target.value as PermissionMode)}
          className={cn(
            'h-6 rounded border bg-surface-2 px-1.5 text-[12.5px] text-text-primary',
            mode === 'bypassPermissions' ? 'border-warn text-warn' : 'border-border-default'
          )}
        >
          {MODES.map((value) => (
            <option key={value} value={value}>
              {MODE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}

function RunSummaryLine({
  summary
}: {
  summary: { numTurns: number | null; durationMs: number | null; costUsd: number | null; denials: number };
}) {
  const parts: string[] = [];
  if (summary.numTurns !== null) parts.push(`${summary.numTurns} turns`);
  if (summary.durationMs !== null) parts.push(duration(summary.durationMs));
  // Notional API-equivalent cost, not money billed on a subscription — see API.md.
  if (summary.costUsd !== null) parts.push(`~$${summary.costUsd.toFixed(3)}`);
  if (summary.denials > 0) parts.push(`${summary.denials} denied`);

  return <p className="tabular border-t border-border-subtle pt-2 text-[12.5px] text-text-muted">{parts.join(' · ')}</p>;
}
