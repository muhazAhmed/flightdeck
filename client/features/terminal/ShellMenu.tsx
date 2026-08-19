import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, SquareTerminal } from 'lucide-react';
import type { ShellProfile } from '@shared/types';
import { cn } from '@/lib/cn';

interface ShellMenuProps {
  profiles: ShellProfile[];
  selectedId: string | null;
  /** Label the running shell reported, shown until the profile list has loaded. */
  runningLabel: string | null;
  onSelect: (id: string) => void;
}

/**
 * Which shell this terminal runs.
 *
 * Only what the machine has: the list comes from server-side detection, so there is no PowerShell 7
 * entry on a machine without it and no Git Bash entry without git installed.
 *
 * Switching restarts the shell. Said plainly in the menu, because a PTY holds no replayable history
 * and pretending otherwise would look like the terminal lost your output.
 */
export function ShellMenu({ profiles, selectedId, runningLabel, onSelect }: ShellMenuProps) {
  const selected = profiles.find((profile) => profile.id === selectedId);
  const label = selected?.label ?? runningLabel ?? 'Shell';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Terminal profile"
        disabled={profiles.length === 0}
        className="flex min-w-0 items-center gap-1.5 rounded-md border border-border-default bg-surface-2 px-2 py-0.5 text-[12px] hover:bg-surface-3 disabled:opacity-60"
      >
        <SquareTerminal size={12} className="shrink-0 text-accent-bright" />
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDown size={11} className="shrink-0 text-text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
        >
          <DropdownMenu.Label className="px-2 py-1 text-[12px] text-text-muted">
            Shells found on this machine
          </DropdownMenu.Label>
          {profiles.map((profile) => (
            <DropdownMenu.Item
              key={profile.id}
              onSelect={() => onSelect(profile.id)}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
            >
              <Check
                size={13}
                className={cn('mt-0.5 shrink-0', profile.id === selectedId ? 'text-accent-bright' : 'opacity-0')}
              />
              <span className="min-w-0">
                <span className="block text-[13px]">{profile.label}</span>
                <span className="block truncate font-mono text-[11px] leading-4 text-text-muted">
                  {profile.note ?? profile.path}
                </span>
              </span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          <p className="px-2 py-1 text-[11.5px] leading-4 text-text-muted">
            Switching starts a fresh shell — a running command is ended and the scrollback is cleared.
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
