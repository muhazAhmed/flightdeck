import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  GitCommitHorizontal,
  Sparkles,
  Square,
  SquareTerminal
} from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { ProjectOverview } from '@shared/types';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { relativeTime, shortPath } from '@/lib/format';
import { attentionFor, type Severity } from './attention';

/** Left edge and reason colour. The card body stays neutral — twenty coloured cards is noise. */
const EDGE: Record<Severity, string> = {
  danger: 'before:bg-danger',
  warn: 'before:bg-warn',
  info: 'before:bg-accent-bright',
  calm: 'before:bg-transparent'
};

const REASON: Record<Severity, string> = {
  danger: 'text-danger',
  warn: 'text-warn',
  info: 'text-text-secondary',
  calm: 'text-text-muted'
};

interface ProjectCardProps {
  project: ProjectOverview;
  onOpen: (projectId: string) => void;
  /** Open this project with its terminal showing — the shortcut for "go run something here". */
  onOpenTerminal: (projectId: string) => void;
  /** Kill the shell without opening the project. Only reachable while one is running. */
  onStopShell: (project: ProjectOverview) => void;
}

/**
 * One project.
 *
 * A div with a button's role rather than a `<button>`, because the card now carries its own controls and a
 * button inside a button is invalid HTML — browsers recover by dropping the nesting, which loses the click
 * handler rather than merely looking wrong. The keyboard contract is kept by hand: Enter and Space open it,
 * exactly as they would on a real button.
 */
export function ProjectCard({ project, onOpen, onOpenTerminal, onStopShell }: ProjectCardProps) {
  const attention = attentionFor(project);
  const changes = project.stagedCount + project.unstagedCount + project.untrackedCount;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only when the card itself has focus: Enter on a nested control must run that control.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(project.projectId);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${project.name}`}
      onClick={() => onOpen(project.projectId)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border border-border-subtle bg-surface-1 p-4 text-left',
        'transition-colors duration-(--duration-fast) hover:border-border hover:bg-surface-2',
        'focus-visible:border-accent focus-visible:outline-none',
        // The severity edge, as a bar rather than a border so the card outline stays consistent.
        'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-[""]',
        EDGE[attention.severity]
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{project.name}</p>
          <p className="truncate font-mono text-[11.5px] text-text-muted" title={project.path}>
            {shortPath(project.path)}
          </p>
        </div>

        {/* Quiet until pointed at, so twenty cards do not read as a wall of icons. Focus reveals them too, so
            they are reachable without a mouse. */}
        <span
          className="flex shrink-0 items-center gap-0.5"
          // The card's own click would open the project, which is not what pressing a control on it means.
          onClick={(event) => event.stopPropagation()}
        >
          {project.shellRunning ? (
            <IconButton
              label="Stop the shell running in this project"
              tone="danger"
              icon={<Square size={11} />}
              onClick={() => onStopShell(project)}
            />
          ) : null}
          <IconButton
            label="Open this project with a terminal"
            icon={<SquareTerminal size={12} />}
            revealOnGroupHover
            disabled={project.missing}
            onClick={() => onOpenTerminal(project.projectId)}
          />
        </span>

        {changes > 0 ? (
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white',
              attention.severity === 'warn' ? 'bg-(--fill-warn)' : 'bg-(--fill-info)'
            )}
            title={`${project.stagedCount} staged · ${project.unstagedCount} modified · ${project.untrackedCount} untracked`}
          >
            {changes > 9 ? '9+' : changes}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-muted">
        <span className="flex min-w-0 items-center gap-1">
          {project.missing ? (
            <AlertTriangle size={11} className="shrink-0 text-danger" />
          ) : (
            <GitBranch size={11} className="shrink-0 text-accent-bright" />
          )}
          <span className="truncate font-mono">{project.branch ?? (project.missing ? 'unknown' : 'detached')}</span>
        </span>
        {project.ahead > 0 ? (
          <span className="flex items-center gap-0.5" title={`${project.ahead} to push`}>
            <ArrowUpFromLine size={10} />
            {project.ahead}
          </span>
        ) : null}
        {project.behind > 0 ? (
          <span className="flex items-center gap-0.5" title={`${project.behind} to pull`}>
            <ArrowDownToLine size={10} />
            {project.behind}
          </span>
        ) : null}
        {/* A shell that outlived its panel is invisible everywhere else, and a forgotten dev server is a port
            you cannot reuse and a build you think is stale. */}
        {project.shellRunning ? (
          <span
            className="flex items-center gap-1 text-text-secondary"
            title="A shell is running here — it keeps going while you work elsewhere"
          >
            <span className="size-1.5 rounded-full bg-success" />
            shell
          </span>
        ) : null}
        {project.lastAgentRunAt ? (
          <span className="flex items-center gap-1" title="Last agent run">
            <Sparkles size={10} />
            {relativeTime(project.lastAgentRunAt)}
          </span>
        ) : null}
      </div>

      {/* Why this card is where it is. Empty for a clean repository, which is the point. */}
      {attention.reasons.length > 0 ? (
        <p className={cn('truncate text-[12px]', REASON[attention.severity])}>
          {attention.reasons.join(' · ')}
        </p>
      ) : null}

      <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-text-muted">
        <GitCommitHorizontal size={11} className="shrink-0" />
        <span className="truncate">
          {project.lastCommitSubject ?? (project.missing ? 'Unavailable' : 'No commits yet')}
        </span>
        {project.lastCommitAt ? (
          <span className="shrink-0 tabular">{relativeTime(project.lastCommitAt)}</span>
        ) : null}
      </p>
    </div>
  );
}
