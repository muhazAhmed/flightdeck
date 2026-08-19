import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Gauge, Sparkles, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { MODEL_OPTIONS, type Chat, type PermissionMode, type Project } from '@shared/types';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { clockTime } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { chatsApi } from './api';
import { RunScriptButton } from './RunScriptButton';

interface ChatHeaderProps {
  chat: Chat;
  project: Project;
  /** Model the running session actually reported, which is the truth when no model is pinned. */
  activeModel: string | null;
  rateLimit: { rateLimitType: string | null; resetsAt: number | null } | null;
  onChatChanged: (chat: Chat) => void;
}

const MODE_LABELS: Record<PermissionMode, string> = {
  acceptEdits: 'Accept edits',
  plan: 'Plan only',
  bypassPermissions: 'Bypass all'
};

const MODE_HINTS: Record<PermissionMode, string> = {
  acceptEdits: 'File edits apply; bash still asks',
  plan: 'Read-only — proposes, changes nothing',
  bypassPermissions: 'Never pauses. Use on throwaway repos'
};

const MODES = Object.keys(MODE_LABELS) as PermissionMode[];

/** Turn a model id into something readable, falling back to the id for anything unlisted (a
 *  session started elsewhere can report a model this picker does not offer). */
function modelLabel(id: string | null | undefined): string {
  if (!id) return 'Default';
  const known = MODEL_OPTIONS.find((m) => m.id === id);
  if (known) return known.label;
  return id.replace(/^claude-/, '').replace(/-/g, ' ');
}

export function ChatHeader({ chat, project, activeModel, rateLimit, onChatChanged }: ChatHeaderProps) {
  const [mode, setMode] = useState<PermissionMode>(chat.permissionMode);
  const [model, setModel] = useState<string>(chat.model ?? '');

  useEffect(() => setMode(chat.permissionMode), [chat.permissionMode]);
  useEffect(() => setModel(chat.model ?? ''), [chat.model]);

  async function changeMode(next: PermissionMode) {
    setMode(next);
    try {
      onChatChanged(await chatsApi.setMode(chat.id, next));
    } catch (err) {
      setMode(chat.permissionMode);
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }

  async function changeModel(next: string) {
    setModel(next);
    try {
      onChatChanged(await chatsApi.setModel(chat.id, next));
    } catch (err) {
      setModel(chat.model ?? '');
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }

  // With nothing pinned, show what the session reported — more useful than the word "Default".
  const shownModel = model || activeModel || '';

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-[14.5px] font-medium">{chat.title}</h2>
        <p className="truncate font-mono text-[11.5px] text-text-muted">{project.path}</p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <RunScriptButton projectId={project.id} />

        {rateLimit?.resetsAt ? (
          <span
            title={`${rateLimit.rateLimitType ?? 'quota'} window resets at ${clockTime(rateLimit.resetsAt)}`}
            className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-[12px] text-text-secondary"
          >
            <Gauge size={12} />
            <span className="tabular">{clockTime(rateLimit.resetsAt)}</span>
          </span>
        ) : null}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2.5 py-1 text-[13px] hover:bg-surface-3">
            <Sparkles size={13} className="text-accent-bright" />
            <span className="max-w-40 truncate">{modelLabel(shownModel)}</span>
            <ChevronDown size={12} className="text-text-muted" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 w-72 rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
            >
              <DropdownMenu.Label className="px-2 py-1 text-[12px] text-text-muted">
                Model for this chat
              </DropdownMenu.Label>
              {MODEL_OPTIONS.map((option) => (
                <DropdownMenu.Item
                  key={option.id || 'default'}
                  onSelect={() => void changeModel(option.id)}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
                >
                  <Check
                    size={13}
                    className={cn('mt-0.5 shrink-0', option.id === model ? 'text-accent-bright' : 'opacity-0')}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px]">{option.label}</span>
                    <span className="block text-[11.5px] leading-4 text-text-muted">{option.hint}</span>
                  </span>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <p className="px-2 py-1 text-[11.5px] leading-4 text-text-muted">
                Applies from your next message. Existing context is kept.
              </p>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label="Permission mode"
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px]',
                mode === 'bypassPermissions'
                  ? 'border-warn text-warn'
                  : 'border-border-default bg-surface-2 hover:bg-surface-3'
              )}
            >
              <SlidersHorizontal size={13} />
              <span>{MODE_LABELS[mode]}</span>
              <ChevronDown size={12} className="text-text-muted" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 w-72 rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
            >
              <DropdownMenu.Label className="px-2 py-1 text-[12px] text-text-muted">
                What the agent may do without asking
              </DropdownMenu.Label>
              {MODES.map((value) => (
                <DropdownMenu.Item
                  key={value}
                  onSelect={() => void changeMode(value)}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
                >
                  <Check size={13} className={cn('mt-0.5 shrink-0', value === mode ? 'text-accent-bright' : 'opacity-0')} />
                  <span className="min-w-0">
                    <span className={cn('block text-[13px]', value === 'bypassPermissions' && 'text-warn')}>
                      {MODE_LABELS[value]}
                    </span>
                    <span className="block text-[11.5px] leading-4 text-text-muted">{MODE_HINTS[value]}</span>
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <IconButton label="Chat settings — not built yet" icon={<SlidersHorizontal size={14} />} disabled />
      </div>
    </header>
  );
}
