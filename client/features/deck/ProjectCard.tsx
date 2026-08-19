import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, GitBranch, GitCommitHorizontal, Sparkles } from 'lucide-react';
import type { ProjectOverview } from '@shared/types';
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

export function ProjectCard({
  project,
  onOpen
}: {
  project: ProjectOverview;
  onOpen: (projectId: string) => void;
}) {
  const attention = attentionFor(project);
  const changes = project.stagedCount + project.unstagedCount + project.untrackedCount;

  return (
    <button
      onClick={() => onOpen(project.projectId)}
      className={cn(
        'relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-border-subtle bg-surface-1 p-4 text-left',
        'transition-colors duration-(--duration-fast) hover:border-border hover:bg-surface-2',
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
    </button>
  );
}
