import { AlertTriangle, Check, CloudDownload, GitBranch, RefreshCw } from 'lucide-react';
import type { Settings, UpdateStatus } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useUpdateCheck } from '@/features/updates/useUpdateCheck';
import { Card } from '../controls/Card';
import { Row } from '../controls/Row';
import { Toggle } from '../controls/Toggle';

interface SectionProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

/** One sentence per state. Vague status text is what makes people ignore an update prompt. */
function headline(status: UpdateStatus): string {
  switch (status.state) {
    case 'behind':
      return `${status.behind} new commit${status.behind === 1 ? '' : 's'} on ${status.upstream}.`;
    case 'up-to-date':
      return 'Up to date with its remote.';
    case 'ahead':
      return `${status.ahead} local commit${status.ahead === 1 ? '' : 's'} not pushed — nothing to pull.`;
    case 'diverged':
      return `Diverged: ${status.ahead} local and ${status.behind} remote commit${status.behind === 1 ? '' : 's'}.`;
    case 'no-upstream':
      return 'This branch tracks no remote, so there is nothing to compare with.';
    case 'not-a-repo':
      return 'This copy is not a git clone, so it cannot check for updates.';
    default:
      return 'Could not read the update state.';
  }
}

/**
 * Where an install stands against its own remote, and the button that moves it.
 *
 * Compared against `origin`, not a hardcoded upstream: someone running a fork should be told about their
 * fork, which is what they push to and pull from.
 */
export function UpdatesSection({ settings, onUpdate }: SectionProps) {
  const { status, busy, check, apply } = useUpdateCheck(settings.checkForUpdates, () => {});
  const behind = status?.state === 'behind';

  return (
    <>
      <Card
        title="This install"
        icon={behind ? <CloudDownload size={14} className="text-accent-bright" /> : <Check size={14} />}
      >
        {status === null ? (
          <p className="text-[13px] text-text-muted">Reading…</p>
        ) : (
          <>
            <p className={cn('text-[13.5px]', behind ? 'text-text-primary' : 'text-text-secondary')}>
              {headline(status)}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-text-muted">
              {status.branch ? (
                <span className="flex items-center gap-1.5">
                  <GitBranch size={11} />
                  <span className="font-mono">{status.branch}</span>
                </span>
              ) : null}
              {status.installed ? (
                <span className="truncate">
                  <span className="font-mono">{status.installed.sha}</span> · {status.installed.subject}
                </span>
              ) : null}
              <span>
                {status.lastFetchedAt ? `checked ${relativeTime(status.lastFetchedAt)} ago` : 'never checked'}
              </span>
            </div>

            {status.dirty ? (
              <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-warn">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                Flight Deck has uncommitted changes of its own. Updating is blocked until they are committed or
                stashed — it would have to touch files you are editing.
              </p>
            ) : null}

            {status.incoming.length > 0 ? (
              <ul className="mt-3 flex flex-col border-t border-border-subtle pt-2">
                {status.incoming.map((commit) => (
                  <li key={commit.sha} className="flex items-baseline gap-2 py-1 text-[12.5px]">
                    <span className="shrink-0 font-mono text-text-muted">{commit.sha}</span>
                    <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
                    <span className="shrink-0 text-text-muted">{relativeTime(commit.at)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void check()}>
                <RefreshCw size={13} className={cn(busy && 'animate-spin')} />
                Check now
              </Button>
              {/* Only offered when a fast-forward is actually possible. A greyed button that would refuse is
                  worse than no button. */}
              {behind && !status.dirty ? (
                <Button size="sm" disabled={busy} onClick={() => void apply()}>
                  <CloudDownload size={13} />
                  Update ({status.behind})
                </Button>
              ) : null}
            </div>

            {behind ? (
              <p className="mt-3 text-[12px] leading-5 text-text-muted">
                Updating fast-forwards only — it never merges, rebases or resets, so a fork with its own commits
                is refused rather than rewritten. Restart the server afterwards, and run{' '}
                <span className="font-mono">npm install</span> if dependencies changed.
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title="Behaviour" icon={<RefreshCw size={14} />}>
        <Row
          label="Check for updates"
          hint="Asks git whether this clone is behind its remote — once per launch, and at most every six hours. Off means no outbound request at all."
        >
          <Toggle
            checked={settings.checkForUpdates}
            onChange={(checkForUpdates) => onUpdate({ checkForUpdates })}
            label="Check for updates"
          />
        </Row>
        <Row
          label="How it checks"
          hint="Your own git remote, not a web service. No API keys, no rate limits, and a fork is compared against the fork."
        >
          <span className="font-mono text-[12.5px] text-text-muted">git fetch</span>
        </Row>
      </Card>
    </>
  );
}
