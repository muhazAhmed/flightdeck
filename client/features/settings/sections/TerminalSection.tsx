import { SquareTerminal, Type } from 'lucide-react';
import type { Settings } from '@shared/types';
import { useShellProfiles } from '@/features/terminal/useShellProfiles';
import { Card } from '../controls/Card';
import { Picker } from '../controls/Picker';
import { Row } from '../controls/Row';
import { Stepper } from '../controls/Stepper';
import { Toggle } from '../controls/Toggle';

interface SectionProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

export function TerminalSection({ settings, onUpdate }: SectionProps) {
  const { profiles, selectedId } = useShellProfiles(settings.terminalShell);

  return (
    <>
      <Card title="Shell" icon={<SquareTerminal size={14} />}>
        <Row
          label="Profile"
          hint="Detected on this machine, not a fixed list — a shell you have not installed is not offered. Switching starts a fresh shell the next time the terminal opens."
        >
          <Picker
            label="Terminal profile"
            value={selectedId ?? ''}
            options={profiles.map((profile) => ({
              value: profile.id,
              label: profile.label,
              hint: profile.note ?? profile.path
            }))}
            onChange={(terminalShell) => onUpdate({ terminalShell })}
          />
        </Row>
        <Row
          label="Override"
          hint="Setting FLIGHTDECK_SHELL in the environment beats everything here, for a shell detection cannot find."
        >
          <span className="font-mono text-[12.5px] text-text-muted">FLIGHTDECK_SHELL</span>
        </Row>
      </Card>

      <Card title="Appearance" icon={<Type size={14} />}>
        <Row label="Font size" hint="Applies to the open terminal immediately; the shell is not restarted.">
          <Stepper
            label="terminal font size"
            value={settings.terminalFontSize}
            min={9}
            max={24}
            step={0.5}
            suffix="px"
            onChange={(terminalFontSize) => onUpdate({ terminalFontSize })}
          />
        </Row>
        <Row label="Blinking cursor" hint="Off is calmer beside a streaming transcript.">
          <Toggle
            checked={settings.terminalCursorBlink}
            onChange={(terminalCursorBlink) => onUpdate({ terminalCursorBlink })}
            label="Blinking cursor"
          />
        </Row>
        <Row
          label="Scrollback"
          hint="Fixed at 5000 lines — enough to scroll back through a build, not enough for a shell to hold a gigabyte of log."
        >
          <span className="text-[13px] text-text-muted">5000 lines</span>
        </Row>
      </Card>

      <Card title="The agent has no terminal" icon={<SquareTerminal size={14} />} muted>
        <p className="text-[13px] leading-5 text-text-muted">
          This shell is yours. The agent runs commands through its own tool and they appear as tool
          cards, so a wedged terminal cannot affect a run and a run cannot type into your shell.
        </p>
      </Card>
    </>
  );
}
