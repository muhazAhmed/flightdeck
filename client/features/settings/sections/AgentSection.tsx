import { ShieldAlert, Sparkles } from 'lucide-react';
import { MODEL_OPTIONS, type PermissionMode, type Settings } from '@shared/types';
import { Card } from '../controls/Card';
import { Choice } from '../controls/Choice';
import { Picker } from '../controls/Picker';
import { Row } from '../controls/Row';

const MODE_OPTIONS: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'acceptEdits', label: 'Accept edits', hint: 'File edits apply; bash still asks' },
  { value: 'plan', label: 'Plan only', hint: 'Read-only — proposes, changes nothing' },
  { value: 'bypassPermissions', label: 'Bypass all', hint: 'Never pauses. Use on throwaway repos' }
];

/** No cap, then three that mean something: a quick fix, a normal task, a long refactor. */
const TURN_CAPS = [
  { value: 0, label: 'No cap' },
  { value: 15, label: '15' },
  { value: 30, label: '30' },
  { value: 60, label: '60' }
];

interface SectionProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

export function AgentSection({ settings, onUpdate }: SectionProps) {
  return (
    <>
      <Card title="Defaults for new work" icon={<Sparkles size={14} />}>
        <Row
          label="Model for new chats"
          hint="Each chat can still be switched individually. Default leaves the choice to your CLI configuration."
        >
          <Picker
            label="Model for new chats"
            value={settings.defaultModel}
            options={MODEL_OPTIONS.map((option) => ({
              value: option.id,
              label: option.label,
              hint: option.hint
            }))}
            onChange={(defaultModel) => onUpdate({ defaultModel })}
          />
        </Row>

        <Row
          label="Permission mode for new projects"
          hint="Applied as a project is added. Projects already on your list keep the mode they have, and any chat can override it."
        >
          <Picker
            label="Permission mode for new projects"
            value={settings.defaultPermissionMode}
            options={MODE_OPTIONS}
            onChange={(defaultPermissionMode) => onUpdate({ defaultPermissionMode })}
          />
        </Row>
      </Card>

      <Card title="Limits" icon={<ShieldAlert size={14} />}>
        <Row
          label="Stop a run after"
          hint="Passed to the CLI as --max-turns. A runaway loop ends on its own instead of spending an afternoon of quota; you can always send another message to continue."
        >
          <Choice
            value={String(settings.maxTurns)}
            options={TURN_CAPS.map((cap) => ({ value: String(cap.value), label: cap.label }))}
            onChange={(value) => onUpdate({ maxTurns: Number(value) })}
          />
        </Row>
      </Card>

      <Card title="What is not here" icon={<Sparkles size={14} />} muted>
        <p className="text-[13px] leading-5 text-text-muted">
          There is no manual approval mode, because this CLI has no channel to ask through — a prompt
          Flight Deck could not answer would hang the run. Tool restrictions and per-project overrides
          are not built yet either.
        </p>
      </Card>
    </>
  );
}
