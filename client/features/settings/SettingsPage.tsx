import { useState, type ReactNode } from 'react';
import {
  Check,
  ExternalLink,
  GitBranch,
  Link2,
  Info,
  Keyboard,
  Lightbulb,
  Lock,
  Monitor,
  Palette,
  RotateCcw,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  SquareTerminal,
  X
} from 'lucide-react';
import type { AccentName, Density, Settings, ThemeName } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';

interface SettingsPageProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
}

interface Section {
  id: string;
  label: string;
  icon: ReactNode;
  /** Sections that exist in the layout but have nothing behind them yet. Rendered disabled rather
   *  than hidden: showing where a thing will live is honest, a button to an empty page is not. */
  ready: boolean;
}

const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon size={14} />, ready: true },
  { id: 'git', label: 'Git & Commit', icon: <GitBranch size={14} />, ready: false },
  { id: 'agent', label: 'AI Assistant', icon: <Sparkles size={14} />, ready: false },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} />, ready: false },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={14} />, ready: false },
  { id: 'privacy', label: 'Privacy', icon: <Lock size={14} />, ready: false }
];

const ACCENTS: { name: AccentName; label: string; swatch: string; note?: string }[] = [
  { name: 'cyan', label: 'Cyan', swatch: '#0e7490' },
  { name: 'violet', label: 'Violet', swatch: '#6d28d9' },
  { name: 'blue', label: 'Blue', swatch: '#1d4ed8' },
  { name: 'green', label: 'Green', swatch: '#15803d', note: 'Shares a hue with added lines in diffs' },
  { name: 'amber', label: 'Amber', swatch: '#a16207', note: 'Shares a hue with warnings' },
  { name: 'pink', label: 'Pink', swatch: '#be185d' },
  { name: 'red', label: 'Red', swatch: '#b91c1c', note: 'Shares a hue with errors and destructive actions' }
];

const LINKS = [
  { label: 'GitHub repository', hint: 'View source and contribute', href: 'https://github.com/muhazAhmed/flightdeck' }
];

export function SettingsPage({ settings, onUpdate, onReset, onClose }: SettingsPageProps) {
  const [section, setSection] = useState('general');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-1 bg-(--bg-base)">
      <nav className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface-1 py-3">
        <p className="px-4 pb-2 text-[12px] font-medium tracking-wide text-text-muted uppercase">Settings</p>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            disabled={!item.ready}
            title={item.ready ? undefined : 'Not built yet'}
            onClick={() => setSection(item.id)}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2 text-left text-[13.5px]',
              'transition-colors duration-(--duration-fast)',
              !item.ready && 'cursor-default opacity-40',
              section === item.id && item.ready
                ? 'border-l-2 border-accent-bright bg-accent-subtle text-text-primary'
                : 'border-l-2 border-transparent text-text-secondary hover:text-text-primary'
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold tracking-tight">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h1>
            <p className="mt-1 text-[13.5px] text-text-secondary">
              How Flight Deck looks and behaves while you work.
            </p>
          </div>
          <IconButton label="Close settings (Esc)" icon={<X size={16} />} onClick={onClose} />
        </header>

        <div className="grid grid-cols-1 gap-5 px-6 pb-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-5">
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

            <Card title="Not built yet" icon={<Monitor size={14} />} muted>
              <p className="text-[13px] leading-5 text-text-muted">
                Git &amp; commit defaults, agent defaults, terminal appearance, custom shortcuts and
                privacy each have a place in the sidebar and nothing behind them yet. They are listed
                rather than hidden so it is clear what is coming.
              </p>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <Card title="About Flight Deck" icon={<Info size={14} />}>
              <p className="text-[13px] leading-5 text-text-secondary">
                Local first. Your files never leave this machine, and nothing is committed unless you
                do it.
              </p>
              <p className="mt-2 text-[12.5px] text-text-muted">
                Runs on the Claude Code CLI you already have installed.
              </p>
            </Card>

            <Card title="Links" icon={<Link2 size={14} />}>
              {LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex flex-col gap-0.5 py-1"
                >
                  <span className="flex items-center gap-1.5 text-[13.5px] text-accent-bright">
                    {link.label}
                    <ExternalLink size={11} />
                  </span>
                  <span className="text-[12px] text-text-muted">{link.hint}</span>
                </a>
              ))}
            </Card>

            <Card title="Tip" icon={<Lightbulb size={14} />}>
              <p className="text-[13px] leading-5 text-text-secondary">
                Every setting here applies immediately and is stored on the server, so a reload or a
                second tab sees the same thing.
              </p>
            </Card>

            <Card title="Reset" icon={<RotateCcw size={14} />}>
              <p className="mb-3 text-[13px] leading-5 text-text-secondary">
                Returns appearance and behaviour to defaults. Projects, chats and saved identities are
                untouched.
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  setConfirm({
                    title: 'Reset settings to defaults?',
                    description:
                      'Appearance and behaviour go back to the shipped values. Your projects, chats and identities are not affected.',
                    files: ['theme, accent, density, confirmations, startup'],
                    confirmLabel: 'Reset',
                    tone: 'danger',
                    onConfirm: onReset
                  })
                }
              >
                Reset to defaults
              </Button>
            </Card>
          </aside>
        </div>
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function Card({
  title,
  icon,
  muted = false,
  children
}: {
  title: string;
  icon: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border-subtle bg-surface-1 p-4',
        muted && 'border-dashed bg-transparent'
      )}
    >
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-text-secondary uppercase">
        <span className="text-text-muted">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle py-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-[12.5px] leading-4 text-text-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A segmented control rather than a `<select>`: two or three options are faster to hit than a
 *  dropdown, and the current value is visible without opening anything. */
function Choice<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border-subtle bg-(--bg-base) p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1 text-[13px] transition-colors duration-(--duration-fast)',
            value === option.value
              ? 'border border-border bg-surface-2 font-medium text-text-primary'
              : 'border border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A switch.
 *
 * The knob is anchored with `left-0.5` and moved by exactly its own travel (`translate-x-5`).
 * Without the anchor an absolutely-positioned child takes its static position from the button's
 * centred text alignment, so the translate pushed it 20px right *of centre* and it hung off the
 * track — which is precisely how this looked before.
 *
 * Geometry, so the numbers are checkable rather than magic: track 44x24 (`w-11 h-6`), knob 20
 * (`size-5`), inset 2 (`0.5`). Travel = 44 - 20 - 2 - 2 = 20 = `translate-x-5`.
 */
function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-(--duration-fast)',
        checked ? 'border-accent bg-accent' : 'border-border bg-surface-3'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm',
          'transition-transform duration-(--duration-fast)',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}
