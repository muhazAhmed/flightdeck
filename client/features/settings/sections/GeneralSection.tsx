import { Palette, Sliders } from 'lucide-react';
import { Check } from 'lucide-react';
import type { AccentName, Density, Settings, ThemeName } from '@shared/types';
import { cn } from '@/lib/cn';
import { Card } from '../controls/Card';
import { Choice } from '../controls/Choice';
import { Row } from '../controls/Row';
import { Toggle } from '../controls/Toggle';

const ACCENTS: { name: AccentName; label: string; swatch: string; note?: string }[] = [
  { name: 'cyan', label: 'Cyan', swatch: '#0e7490' },
  { name: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { name: 'blue', label: 'Blue', swatch: '#2563eb' },
  { name: 'green', label: 'Green', swatch: '#15803d', note: 'Shares a hue with added lines in diffs' },
  { name: 'amber', label: 'Amber', swatch: '#b45309', note: 'Shares a hue with warnings' },
  { name: 'pink', label: 'Pink', swatch: '#db2777' },
  { name: 'red', label: 'Red', swatch: '#dc2626', note: 'Shares a hue with errors and destructive actions' }
];

interface SectionProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

export function GeneralSection({ settings, onUpdate }: SectionProps) {
  return (
    <>
      <Card title="Appearance" icon={<Palette size={14} />}>
        <Row label="Theme" hint="Dark and light are both styled from the same tokens.">
          <Choice<ThemeName>
            value={settings.theme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' }
            ]}
            onChange={(theme) => onUpdate({ theme })}
          />
        </Row>

        <Row
          label="Accent colour"
          hint="Buttons, counts, focus rings and selected rows. Green and red stay reserved for diffs and errors whatever you pick."
        >
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.name}
                onClick={() => onUpdate({ accent: accent.name })}
                title={accent.note ? `${accent.label} — ${accent.note}` : accent.label}
                aria-label={accent.label}
                aria-pressed={settings.accent === accent.name}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full',
                  'transition-transform duration-(--duration-fast) hover:scale-110',
                  settings.accent === accent.name &&
                    'ring-2 ring-text-primary ring-offset-2 ring-offset-(--surface-1)'
                )}
                style={{ backgroundColor: accent.swatch }}
              >
                {settings.accent === accent.name ? <Check size={13} className="text-white" /> : null}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Density" hint="Compact reduces the type scale. Spacing is unchanged.">
          <Choice<Density>
            value={settings.density}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' }
            ]}
            onChange={(density) => onUpdate({ density })}
          />
        </Row>
      </Card>

      <Card title="Behaviour" icon={<Sliders size={14} />}>
        <Row
          label="Confirm source-control actions"
          hint="Discard, force-delete and overwriting a typed message always ask. This governs the reversible ones — staging, stashing, pull and push."
        >
          <Choice
            value={settings.confirmLevel}
            options={[
              { value: 'all' as const, label: 'Every action' },
              { value: 'destructive' as const, label: 'Only destructive' }
            ]}
            onChange={(confirmLevel) => onUpdate({ confirmLevel })}
          />
        </Row>

        <Row label="Reopen last project" hint="Start where you left off instead of on an empty deck.">
          <Toggle
            checked={settings.restoreLastProject}
            onChange={(restoreLastProject) => onUpdate({ restoreLastProject })}
            label="Reopen last project"
          />
        </Row>
      </Card>
    </>
  );
}
