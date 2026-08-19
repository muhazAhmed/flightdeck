import { useEffect, useState } from 'react';
import { Eraser, Rocket, Square, X } from 'lucide-react';
import type { Project } from '@shared/types';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { FastForwardButton } from './FastForwardButton';
import { ShellMenu } from './ShellMenu';
import { useBuildTrigger } from './useBuildTrigger';
import { useShellProfiles } from './useShellProfiles';
import { useTerminal } from './useTerminal';

interface TerminalDrawerProps {
  project: Project | null;
  /** Chosen shell profile id from settings; empty means "whatever the server detects". */
  shellId: string;
  fontSize: number;
  cursorBlink: boolean;
  onShellChange: (id: string) => void;
  /** Called after the build trigger commits or a fast-forward lands — an immediate refresh, since the action came
   *  from this header and its result is known. */
  onCommitted: () => void;
  /**
   * Called as the shell produces output.
   *
   * Fired per chunk, so the listener must debounce: a `git status` per chunk of a build log would be absurd. It
   * exists because a merge, checkout, commit or pull typed in here moves exactly the state the Changes panel shows.
   */
  onShellActivity: () => void;
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
export function TerminalDrawer({
  project,
  shellId,
  fontSize,
  cursorBlink,
  onShellChange,
  onCommitted,
  onShellActivity,
  onClose
}: TerminalDrawerProps) {
  const { profiles, selectedId } = useShellProfiles(shellId);
  const { containerRef, status, focus, clear, stop } = useTerminal(
    project?.id ?? null,
    selectedId,
    { fontSize, cursorBlink },
    // Anything you run in here — merge, checkout, commit, pull — moves the same state the Changes panel shows.
    onShellActivity
  );
  const { trigger, running } = useBuildTrigger(project?.id ?? null, onCommitted);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

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

        {/* The shell outlives this drawer now, so whether it was already running is worth saying: it explains why
            there is output above the prompt, and why closing the panel did not stop the dev server. */}
        {status.restored ? (
          <span
            title="This shell was already running — it kept going while you were elsewhere"
            className="flex shrink-0 items-center gap-1 rounded border border-border-subtle px-1 text-[10.5px] text-text-muted"
          >
            <span className="size-1.5 rounded-full bg-success" />
            live
          </span>
        ) : null}

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

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <FastForwardButton project={project} onMerged={onCommitted} />
        </span>

        <span className="flex shrink-0 items-center gap-0.5">
          {/* Pushes, so it always asks first — and the dialog shows the two commands verbatim rather
              than describing them. */}
          <IconButton
            label={running ? 'Triggering a build…' : 'Trigger a build — empty commit, then push'}
            icon={<Rocket size={13} className={running ? 'text-text-muted' : 'text-accent-bright'} />}
            disabled={running}
            onClick={() =>
              setConfirm({
                title: `Trigger a build on ${project.name}?`,
                description:
                  'Creates a commit with no changes and pushes it to the branch it tracks, which is enough to start a pipeline that only runs on new commits. Nothing in your working tree is committed — and if anything is staged, this is refused rather than carrying it along.',
                files: ['git commit --allow-empty -m "trigger build"', 'git push'],
                confirmLabel: 'Commit and push',
                onConfirm: () => void trigger()
              })
            }
          />
          <IconButton label="Clear the terminal" icon={<Eraser size={13} />} onClick={clear} />
          {/* Closing the drawer leaves the shell running, so stopping it has to be its own action. */}
          <IconButton
            label="Stop this shell — kills whatever is running in it"
            tone="danger"
            icon={<Square size={12} />}
            onClick={() =>
              setConfirm({
                title: `Stop the shell in ${project.name}?`,
                description:
                  'Kills the shell and anything running in it, including a dev server. Closing this panel does not — the shell keeps running so you can switch projects and come back.',
                files: [status.shell ?? 'shell'],
                confirmLabel: 'Stop shell',
                tone: 'danger',
                onConfirm: stop
              })
            }
          />
          <IconButton label="Close the terminal (Ctrl+J)" icon={<X size={14} />} onClick={onClose} />
        </span>
      </header>

      {/* xterm measures its container, so this element must have a real size before it fits. The
          hook re-fits on every resize, including the drag handle above it. */}
      <div ref={containerRef} onClick={focus} className="min-h-0 flex-1 px-2 py-1" />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
