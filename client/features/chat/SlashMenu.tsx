import { useEffect, useState } from 'react';
import { Slash, Sparkles } from 'lucide-react';
import type { SlashCommand } from '@shared/types';
import { http } from '@/lib/http';
import { cn } from '@/lib/cn';

/**
 * Commands and skills available in a project.
 *
 * Fetched once per project rather than per keystroke: it is a filesystem read on the server, and the answer only
 * changes when someone adds a file. A failure is silent — autocomplete is a convenience, and typing the command
 * by hand still works exactly as before.
 */
export function useSlashCommands(projectId: string | null) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);

  useEffect(() => {
    if (!projectId) {
      setCommands([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await http.get<{ commands: SlashCommand[] }>(
          `/api/commands?projectId=${encodeURIComponent(projectId)}`
        );
        if (!cancelled) setCommands(result.commands);
      } catch {
        if (!cancelled) setCommands([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return commands;
}

/**
 * The query a value implies, or null when the menu should be closed.
 *
 * Only a leading slash counts, and only while the first token is still being typed — that is what the CLI itself
 * treats as a command, and a menu that opened on a slash mid-sentence (a path, a fraction, a regex) would fight
 * the person typing. A space means the command has been chosen and the rest is arguments.
 */
export function slashQuery(value: string): string | null {
  const match = /^\/([A-Za-z0-9_:-]*)$/.exec(value);
  return match ? (match[1] ?? '') : null;
}

/** Prefix matches first, then anything containing the query: `/dep` should find `/deploy` before `/redeploy`. */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (query.length === 0) return commands;
  const needle = query.toLowerCase();
  const prefix: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) prefix.push(command);
    else if (name.includes(needle)) contains.push(command);
  }
  return [...prefix, ...contains];
}

interface SlashMenuProps {
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

/**
 * The list itself.
 *
 * Sits above the input rather than below, because the input is already at the bottom of the window — a dropdown
 * would open off-screen.
 */
export function SlashMenu({ commands, activeIndex, onPick, onHover }: SlashMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 z-40 mb-2 w-full max-w-2xl overflow-hidden rounded-lg border border-border-default bg-surface-2 shadow-(--shadow-popover)">
      <p className="border-b border-border-subtle px-3 py-1.5 text-[11.5px] text-text-muted">
        {commands.length} match{commands.length === 1 ? '' : 'es'} · <kbd className="font-mono">↑↓</kbd> to move ·{' '}
        <kbd className="font-mono">Enter</kbd> to insert · <kbd className="font-mono">Esc</kbd> to dismiss
      </p>
      <ul className="max-h-64 overflow-y-auto">
        {commands.map((command, index) => (
          <li key={`${command.source}-${command.kind ?? 'command'}-${command.name}`}>
            <button
              type="button"
              // Mouse down rather than click: the textarea loses focus on mousedown, and a click handler would
              // fire after the blur had already closed the menu.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(command);
              }}
              onMouseEnter={() => onHover(index)}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-1.5 text-left',
                index === activeIndex ? 'bg-accent-subtle' : 'hover:bg-surface-3'
              )}
            >
              <span className="mt-0.5 shrink-0 text-text-muted">
                {command.kind === 'skill' ? <Sparkles size={12} className="text-accent-bright" /> : <Slash size={12} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px]">/{command.name}</span>
                  {command.argumentHint ? (
                    <span className="truncate font-mono text-[11.5px] text-text-muted">{command.argumentHint}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 rounded border border-border-subtle px-1 text-[10.5px] text-text-muted">
                    {command.kind === 'skill' ? 'skill' : command.source}
                  </span>
                </span>
                {command.description ? (
                  <span className="mt-0.5 block truncate text-[12px] text-text-secondary">{command.description}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
