import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { Chat, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { duration } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { chatsApi } from './api';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatHeader } from './ChatHeader';
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

export function ChatPanel({ project, chat, onCreateChat, onChatChanged, onRunStateChange }: ChatPanelProps) {
  const { blocks, running, error, summary, rateLimit, session, send, stop, hydrate } = useChatStream(chat?.id ?? null);
  // Lets a suggestion card put text in the input rather than sending it blind, so it can be
  // edited first.
  const [draft, setDraft] = useState<string | null>(null);
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
      <ChatHeader
        chat={chat}
        project={project}
        activeModel={session?.model ?? null}
        rateLimit={rateLimit}
        onChatChanged={onChatChanged}
      />

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
          <ChatEmptyState project={project} onPick={setDraft} />
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

      <PromptInput
        running={running}
        draft={draft}
        onDraftConsumed={() => setDraft(null)}
        onSend={send}
        onStop={stop}
      />
    </section>
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
