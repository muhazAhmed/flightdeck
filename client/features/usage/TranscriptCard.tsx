import { FileClock, Info } from 'lucide-react';
import type { ProjectTranscriptUsage, TranscriptSession } from '@shared/types';
import { Card } from '@/features/settings/controls/Card';
import { relativeTime } from '@/lib/format';
import { tokens } from './format';

/**
 * Work found in Claude Code's own transcripts.
 *
 * The usage log only knows about runs Flight Deck spawned. A long conversation held in a terminal or an
 * editor spends the same quota against the same repository, and leaving it out made the page read as
 * broken rather than incomplete.
 *
 * NO COST COLUMN, ON PURPOSE. A transcript carries token counts and a model, and no price — `total_cost_usd`
 * belongs to the `result` record, which never reaches the file. Pricing it here would turn the one number
 * someone might act on into a guess, so this table reports what is actually recorded.
 */
export function TranscriptCard({
  projects,
  onOpenProject
}: {
  projects: ProjectTranscriptUsage[];
  onOpenProject?: (projectId: string) => void;
}) {
  if (projects.length === 0) return null;

  return (
    <Card title="Sessions on disk" icon={<FileClock size={14} />}>
      <p className="mb-3 flex items-start gap-2 text-[12.5px] leading-5 text-text-muted">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Read from Claude Code's transcripts, so conversations you ran in a terminal or an editor are
          counted too. Tokens only — a transcript records no cost, and these are kept out of the cost
          figures above rather than priced by guesswork.
        </span>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] tracking-wide text-text-muted uppercase">
              <th className="pb-2 font-medium">Project</th>
              <th className="pb-2 text-right font-medium">Sessions</th>
              <th className="pb-2 text-right font-medium">Messages</th>
              <th className="pb-2 text-right font-medium">Output</th>
              <th className="pb-2 text-right font-medium">Cache read</th>
              <th className="pb-2 text-right font-medium">Last</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.projectId} className="border-t border-border-subtle">
                <td className="max-w-56 py-2">
                  {onOpenProject ? (
                    <button
                      onClick={() => onOpenProject(project.projectId)}
                      className="block max-w-full truncate text-left hover:text-accent-bright"
                    >
                      {project.name}
                    </button>
                  ) : (
                    <span className="block max-w-full truncate">{project.name}</span>
                  )}
                </td>
                <td className="py-2 text-right tabular">{project.sessions.length}</td>
                <td className="py-2 text-right tabular">{project.messages}</td>
                <td className="py-2 text-right tabular">{tokens(project.outputTokens)}</td>
                <td className="py-2 text-right tabular text-text-muted">{tokens(project.cacheReadTokens)}</td>
                <td className="py-2 text-right tabular text-text-muted">
                  {project.lastAt ? relativeTime(project.lastAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** The same data for one project, session by session. */
export function TranscriptSessions({
  sessions,
  adopted
}: {
  sessions: TranscriptSession[];
  adopted: string[];
}) {
  if (sessions.length === 0) return null;
  const adoptedSet = new Set(adopted);

  return (
    <Card title="Sessions on disk" icon={<FileClock size={14} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] tracking-wide text-text-muted uppercase">
              <th className="pb-2 font-medium">Session</th>
              <th className="pb-2 font-medium">Model</th>
              <th className="pb-2 text-right font-medium">Messages</th>
              <th className="pb-2 text-right font-medium">Output</th>
              <th className="pb-2 text-right font-medium">Cache read</th>
              <th className="pb-2 text-right font-medium">Last</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.sessionId} className="border-t border-border-subtle">
                <td className="py-2 font-mono text-[12px]">
                  {session.sessionId.slice(0, 8)}
                  {/* Marks the ones already imported here, so this list and the run list reconcile. */}
                  {adoptedSet.has(session.sessionId) ? (
                    <span className="ml-1.5 rounded border border-border-subtle px-1 text-[10.5px] text-text-muted">
                      in Flight Deck
                    </span>
                  ) : null}
                </td>
                <td className="py-2 font-mono text-[12px] text-text-muted">
                  {session.model.replace(/^claude-/, '')}
                </td>
                <td className="py-2 text-right tabular">{session.messages}</td>
                <td className="py-2 text-right tabular">{tokens(session.outputTokens)}</td>
                <td className="py-2 text-right tabular text-text-muted">{tokens(session.cacheReadTokens)}</td>
                <td className="py-2 text-right tabular text-text-muted">{relativeTime(session.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-text-muted">
        Tokens come from the transcript itself. It records no cost, so these sessions do not appear in the
        cost figures above.
      </p>
    </Card>
  );
}
