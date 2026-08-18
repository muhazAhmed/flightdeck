import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronRight, CircleAlert, Loader } from 'lucide-react';
import { cn } from '@/lib/cn';
import { duration } from '@/lib/format';
import type { ToolInvocation } from './useChatStream';

/** Tools whose first argument is worth showing in the collapsed header, in order of
 *  preference. Keeps `Edit src/app/page.tsx` on one line instead of a JSON blob. */
const HEADLINE_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'description'];

function headline(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  for (const key of HEADLINE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function elapsed(tool: ToolInvocation): string | null {
  const end = tool.finishedAt ?? Date.now();
  const ms = end - tool.startedAt;
  // Only worth showing once it is slow enough that the user might wonder if it hung.
  return ms >= 10_000 ? duration(ms) : null;
}

export function ToolCard({ tool }: { tool: ToolInvocation }) {
  const [open, setOpen] = useState(false);
  const pending = tool.result === null;
  const summary = headline(tool.input);
  const time = elapsed(tool);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'overflow-hidden rounded-md border bg-surface-2',
          tool.isError ? 'border-danger/50' : 'border-border-subtle'
        )}
      >
        <Collapsible.Trigger
          className={cn(
            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
            'transition-colors duration-(--duration-fast) hover:bg-surface-3'
          )}
        >
          <ChevronRight
            size={13}
            className={cn(
              'shrink-0 text-text-muted transition-transform duration-(--duration-fast)',
              open && 'rotate-90'
            )}
          />
          <span className="shrink-0 font-medium text-text-primary">{tool.name}</span>
          {summary ? (
            <span className="truncate font-mono text-[12.5px] text-text-secondary">{summary}</span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[12.5px]">
            {time ? <span className="tabular text-text-muted">{time}</span> : null}
            {pending ? (
              <Loader size={12} className="animate-spin text-accent-bright" />
            ) : tool.isError ? (
              <CircleAlert size={12} className="text-danger" />
            ) : null}
          </span>
        </Collapsible.Trigger>

        <Collapsible.Content className="border-t border-border-subtle">
          <div className="max-h-80 overflow-auto px-2.5 py-2">
            {summary === null ? (
              <pre className="mb-2 font-mono text-[12.5px] whitespace-pre-wrap text-text-secondary">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            ) : null}
            {tool.result === null ? (
              <p className="text-[12.5px] text-text-muted">Running…</p>
            ) : (
              <pre
                className={cn(
                  'font-mono text-[12.5px] leading-[18px] whitespace-pre-wrap',
                  tool.isError ? 'text-danger' : 'text-text-secondary'
                )}
              >
                {tool.result}
              </pre>
            )}
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
