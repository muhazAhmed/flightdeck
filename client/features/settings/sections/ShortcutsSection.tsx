import { Keyboard } from 'lucide-react';
import { Card } from '../controls/Card';

interface Shortcut {
  keys: string[];
  action: string;
}

const GLOBAL: Shortcut[] = [
  { keys: ['Ctrl', 'K'], action: 'Command palette — jump to any project or chat' },
  { keys: ['Ctrl', 'J'], action: 'Toggle the terminal' },
  { keys: ['Ctrl', 'B'], action: 'Toggle the project sidebar' },
  { keys: ['Ctrl', 'Shift', 'G'], action: 'Toggle the Changes panel' },
  { keys: ['Ctrl', ','], action: 'Open settings' },
  { keys: ['Esc'], action: 'Leave settings' }
];

const CHAT: Shortcut[] = [
  { keys: ['Enter'], action: 'Send the prompt' },
  { keys: ['Shift', 'Enter'], action: 'New line' },
  { keys: ['Ctrl', 'Enter'], action: 'Send the prompt, for the muscle memory' }
];

export function ShortcutsSection() {
  return (
    <>
      <Card title="Anywhere" icon={<Keyboard size={14} />}>
        <List shortcuts={GLOBAL} />
      </Card>

      <Card title="In the prompt box" icon={<Keyboard size={14} />}>
        <List shortcuts={CHAT} />
      </Card>

      <Card title="Reference only" icon={<Keyboard size={14} />} muted>
        <p className="text-[13px] leading-5 text-text-muted">
          These are listed so they are discoverable, not editable — remapping is not built. On macOS,{' '}
          <Key>Cmd</Key> works in place of <Key>Ctrl</Key> everywhere.
        </p>
      </Card>
    </>
  );
}

function List({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <ul className="flex flex-col">
      {shortcuts.map((shortcut) => (
        <li
          key={shortcut.keys.join('+')}
          className="flex items-center gap-4 border-b border-border-subtle py-2 last:border-b-0 last:pb-0"
        >
          <span className="flex shrink-0 items-center gap-1">
            {shortcut.keys.map((key) => (
              <Key key={key}>{key}</Key>
            ))}
          </span>
          <span className="min-w-0 text-[13px] text-text-secondary">{shortcut.action}</span>
        </li>
      ))}
    </ul>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border-default bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-text-primary">
      {children}
    </kbd>
  );
}
