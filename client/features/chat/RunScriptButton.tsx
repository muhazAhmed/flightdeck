import { useCallback, useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Play, Terminal } from 'lucide-react';
import type { ProjectScripts } from '@shared/types';
import { http } from '@/lib/http';
import { cn } from '@/lib/cn';
import { useWorkspace } from '@/store/workspace';

/**
 * Run one of a project's package scripts.
 *
 * WHERE THE OUTPUT GOES is the whole design. A dev server prints continuously, needs to be stopped with `Ctrl+C`,
 * and dies with its terminal — so it belongs in the terminal, not in a panel invented for it. The button opens the
 * drawer and types the command, which means everything about the running process behaves exactly as it does when you
 * type it yourself: scrollback, colour, signals, and the process ending when the shell does.
 *
 * That is the opposite trade-off from the build trigger, which runs server-side precisely to avoid the shell. The
 * distinction: that command is fixed and its result is a git state; this one is a long-running process whose log is
 * the point.
 */
export function RunScriptButton({ projectId }: { projectId: string }) {
  const [scripts, setScripts] = useState<ProjectScripts | null>(null);
  const runInTerminal = useWorkspace((s) => s.runInTerminal);

  const load = useCallback(async () => {
    try {
      setScripts(await http.get<ProjectScripts>(`/api/scripts?projectId=${encodeURIComponent(projectId)}`));
    } catch {
      // Not every project is a Node project; the button simply does not appear.
      setScripts(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing runnable: no package.json, no scripts, or a project of a kind this does not understand.
  if (!scripts || scripts.scripts.length === 0) return null;

  const suggested = scripts.suggested;
  const primary = suggested ? scripts.scripts.find((script) => script.name === suggested) : undefined;

  return (
    /*
       One bordered container with a divider inside it, rather than two bordered buttons meant to abut.
       Two adjacent borders leave a seam that renders as a gap at some zoom levels and device pixel ratios, which is
       what it did here — the halves looked like separate controls. The border and background live on the wrapper,
       the children carry none, and `overflow-hidden` clips them to the rounded corners.
    */
    <span className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-border-default bg-surface-2">
      {primary ? (
        <button
          onClick={() => runInTerminal(primary.run)}
          title={`${primary.run} — typed into the terminal, so Ctrl+C stops it`}
          className="flex items-center gap-1.5 px-2.5 text-[13px] transition-colors duration-(--duration-fast) hover:bg-surface-3"
        >
          <Play size={12} className="text-accent-bright" />
          <span className="font-mono">{primary.name}</span>
        </button>
      ) : null}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          title="Run a script in the terminal"
          className={cn(
            'flex items-center gap-1.5 px-2 text-[13px] transition-colors duration-(--duration-fast) hover:bg-surface-3',
            // The divider only exists when there is something to its left.
            primary && 'border-l border-border-subtle'
          )}
        >
          {primary ? null : <Play size={12} className="text-accent-bright" />}
          {primary ? null : <span>Run</span>}
          <ChevronDown size={11} className="text-text-muted" />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 max-h-80 w-80 overflow-y-auto rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
          >
            <DropdownMenu.Label className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-text-muted">
              <Terminal size={11} />
              Typed into the terminal · {scripts.manager}
            </DropdownMenu.Label>

            {scripts.scripts.map((script) => (
              <DropdownMenu.Item
                key={script.name}
                onSelect={() => runInTerminal(script.run)}
                className="flex cursor-pointer flex-col gap-0.5 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="font-mono text-[13px] text-text-primary">{script.name}</span>
                  {script.name === suggested ? (
                    <span className="ml-auto shrink-0 text-[10.5px] text-text-muted">suggested</span>
                  ) : null}
                </span>
                {/* The script body, because a name like `dev:all` says nothing about what it starts. */}
                <span className="w-full truncate font-mono text-[11px] text-text-muted">{script.command}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}
