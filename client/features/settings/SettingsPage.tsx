import { useState, type ReactNode } from 'react';
import {
  ExternalLink,
  GitBranch,
  Link2,
  Info,
  Keyboard,
  Lightbulb,
  Lock,
  RotateCcw,
  Settings as SettingsIcon,
  Sparkles,
  SquareTerminal,
  X
} from 'lucide-react';
import type { Settings } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { Card } from './controls/Card';
import { AgentSection } from './sections/AgentSection';
import { GeneralSection } from './sections/GeneralSection';
import { GitSection } from './sections/GitSection';
import { PrivacySection } from './sections/PrivacySection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { TerminalSection } from './sections/TerminalSection';

interface SettingsPageProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
}

type SectionId = 'general' | 'git' | 'agent' | 'terminal' | 'shortcuts' | 'privacy';

interface Section {
  id: SectionId;
  label: string;
  icon: ReactNode;
  /** One line under the section title, so a page never opens without saying what it governs. */
  blurb: string;
}

const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon size={14} />, blurb: 'How Flight Deck looks and behaves while you work.' },
  { id: 'git', label: 'Git & Commit', icon: <GitBranch size={14} />, blurb: 'What happens when you commit, and who writes the message.' },
  { id: 'agent', label: 'AI Assistant', icon: <Sparkles size={14} />, blurb: 'Defaults for new chats and projects, and the limits on a run.' },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} />, blurb: 'Which shell opens, and how it looks.' },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={14} />, blurb: 'Every key this app listens for.' },
  { id: 'privacy', label: 'Privacy', icon: <Lock size={14} />, blurb: 'What is on disk, and what leaves this machine.' }
];

const LINKS = [
  { label: 'GitHub repository', hint: 'View source and contribute', href: 'https://github.com/muhazAhmed/flightdeck' }
];

export function SettingsPage({ settings, onUpdate, onReset, onClose }: SettingsPageProps) {
  const [section, setSection] = useState<SectionId>('general');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;

  return (
    <div className="flex h-full min-h-0 flex-1 bg-(--bg-base)">
      <nav className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface-1 py-3">
        <p className="px-4 pb-2 text-[12px] font-medium tracking-wide text-text-muted uppercase">Settings</p>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            onClick={() => setSection(item.id)}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2 text-left text-[13.5px]',
              'transition-colors duration-(--duration-fast)',
              section === item.id
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
            <h1 className="text-[22px] font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-[13.5px] text-text-secondary">{active.blurb}</p>
          </div>
          <IconButton label="Close settings (Esc)" icon={<X size={16} />} onClick={onClose} />
        </header>

        <div className="grid grid-cols-1 gap-5 px-6 pb-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-5">
            {section === 'general' ? <GeneralSection settings={settings} onUpdate={onUpdate} /> : null}
            {section === 'git' ? <GitSection settings={settings} onUpdate={onUpdate} /> : null}
            {section === 'agent' ? <AgentSection settings={settings} onUpdate={onUpdate} /> : null}
            {section === 'terminal' ? <TerminalSection settings={settings} onUpdate={onUpdate} /> : null}
            {section === 'shortcuts' ? <ShortcutsSection /> : null}
            {section === 'privacy' ? <PrivacySection onConfirm={setConfirm} /> : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <Card title="About Flight Deck" icon={<Info size={14} />}>
              <img
                src="/logo.png"
                alt=""
                width={48}
                height={48}
                className="mb-3 size-12 rounded-lg"
              />
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
                Returns every section to its default. Projects, chats, saved identities and attachments
                are untouched.
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  setConfirm({
                    title: 'Reset settings to defaults?',
                    description:
                      'Appearance, behaviour, git, agent and terminal preferences go back to the shipped values. Your projects, chats, identities and attachments are not affected.',
                    files: ['appearance, behaviour, git, agent, terminal'],
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
