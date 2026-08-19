import { useEffect } from 'react';
import { Eraser, X } from 'lucide-react';
import type { Project } from '@shared/types';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { ShellMenu } from './ShellMenu';
import { useShellProfiles } from './useShellProfiles';
import { useTerminal } from './useTerminal';

interface TerminalDrawerProps {
  project: Project | null;
  /** Chosen shell profile id from settings; empty means "whatever the server detects". */
  shellId: string;
  onShellChange: (id: string) => void;
  onClose: () => void;
}

/**
 * A shell at the bottom of the chat column, in the project's folder.
 *
 * Sits inside the centre column rather than spanning the window, so the Changes panel stays visible
 * while you work — the point of a terminal here is running a build and watching the file list react
 * to it.
 *
 * It is yours: the agent never gets a PTY. Its commands run through its own Bash tool and appear as
 * tool cards, which keeps a wedged shell from affecting a run and a run from typing into your shell.
 */
export function TerminalDrawer({ project, shellId, onShellChange, onClose }: TerminalDrawerProps) {
  const { profiles, selectedId } = useShellProfiles(shellId);
  const { containerRef, status, focus, clear } = useTerminal(project?.id ?? null, selectedId);

  // Opening it should mean you can type immediately.
  useEffect(() => {
    if (status.state === 'ready') focus();
  }, [status.state, focus]);

  if (!project) {
    return (
      <div className="flex h-full flex-col border-t border-border-default bg-(--bg-base)">
        <EmptyState title="No project selected" hint="A terminal opens in the selected project's folder." />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col border-t border-border-default bg-(--bg-base)">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5">
        <ShellMenu
          profiles={profiles}
          selectedId={selectedId}
          runningLabel={status.shell}
          onSelect={onShellChange}
        />
        <span className="truncate font-mono text-[11.5px] text-text-muted">{project.name}</span>

        {status.state !== 'ready' ? (
          <span
            className={cn(
              'truncate text-[11.5px]',
              status.state === 'error' ? 'text-danger' : 'text-text-muted'
            )}
          >
            {status.message ?? 'Starting…'}
          </span>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="Clear the terminal" icon={<Eraser size={13} />} onClick={clear} />
          <IconButton label="Close the terminal (Ctrl+J)" icon={<X size={14} />} onClick={onClose} />
        </span>
      </header>

      {/* xterm measures its container, so this element must have a real size before it fits. The
          hook re-fits on every resize, including the drag handle above it. */}
      <div ref={containerRef} onClick={focus} className="min-h-0 flex-1 px-2 py-1" />
    </section>
  );
}
