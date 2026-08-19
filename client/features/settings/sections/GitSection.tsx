import { GitBranch, Sparkles } from 'lucide-react';
import { MODEL_OPTIONS, type Settings } from '@shared/types';
import { Card } from '../controls/Card';
import { Picker } from '../controls/Picker';
import { Row } from '../controls/Row';
import { Toggle } from '../controls/Toggle';

interface SectionProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

export function GitSection({ settings, onUpdate }: SectionProps) {
  return (
    <>
      <Card title="Commits" icon={<GitBranch size={14} />}>
        <Row
          label="Add a Signed-off-by line"
          hint="Uses the identity git will attribute the commit to — the one shown above the commit box — so the trailer can never disagree with the author."
        >
          <Toggle
            checked={settings.commitSignoff}
            onChange={(commitSignoff) => onUpdate({ commitSignoff })}
            label="Add a Signed-off-by line"
          />
        </Row>
      </Card>

      <Card title="Drafted messages" icon={<Sparkles size={14} />}>
        <Row
          label="Model that writes commit messages"
          hint="One short prompt over the staged diff, with tools denied. A smaller model is usually enough and returns in a couple of seconds."
        >
          <Picker
            label="Model that writes commit messages"
            value={settings.draftModel}
            options={MODEL_OPTIONS.map((option) => ({
              value: option.id,
              label: option.label,
              hint: option.hint
            }))}
            onChange={(draftModel) => onUpdate({ draftModel })}
          />
        </Row>
        <Row
          label="Large diffs"
          hint="A staged diff over roughly 120,000 characters is truncated before it is sent, and the draft says so above the box. Nothing is silently dropped."
        >
          <span className="text-[13px] text-text-muted">Truncated with a warning</span>
        </Row>
      </Card>

      <Card title="Fixed by design" icon={<GitBranch size={14} />} muted>
        <p className="text-[13px] leading-5 text-text-muted">
          Pull is always <span className="font-mono">--ff-only</span> and refuses on a dirty tree. Push
          is never forced. There is no setting for either, and no merge, rebase or{' '}
          <span className="font-mono">reset --hard</span> anywhere in the tool — those belong in a
          terminal, done consciously.
        </p>
      </Card>
    </>
  );
}
