/**
 * Per-project cost, tokens and quota.
 *
 * Reads the append-only log written as each run finishes. No agent, no network — arithmetic over a
 * file, so it stays instant however long the log gets.
 */
import type { FastifyInstance } from 'fastify';
import type { ProjectTranscriptUsage, ProjectUsageReport, UsageReport } from '@shared/types';
import * as state from '../state.js';
import * as usage from '../usage.js';
import { sessionsForProject } from '../transcriptUsage.js';
import { badRequest } from '../errors.js';

/** Ranges the UI offers. 0 means everything recorded. */
const ALLOWED_DAYS = new Set([1, 7, 30, 90, 0]);

/** Shared by both routes so a bad range is refused the same way. */
function parseDays(raw: string | undefined): number | null {
  const days = raw === undefined ? 30 : Number(raw);
  if (!Number.isInteger(days) || !ALLOWED_DAYS.has(days)) return null;
  return days;
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { days?: string } }>('/api/usage', async (req, reply): Promise<UsageReport | never> => {
    const days = parseDays(req.query.days);
    if (days === null) return badRequest(reply, `days must be one of ${[...ALLOWED_DAYS].join(', ')}.`) as never;

    const current = state.read();
    // A run's project can be removed from the list later. Its history is kept and labelled rather than
    // dropped, because the money was still spent.
    const names = new Map(current.projects.map((project) => [project.id, project.name]));

    return usage.aggregate(usage.read(), {
      days,
      now: Date.now(),
      nameOf: (projectId) => names.get(projectId) ?? `${projectId} (removed)`,
      windowResetsAt: current.lastRateLimit?.resetsAt ?? null,
      rateLimitType: current.lastRateLimit?.rateLimitType ?? null
    });
  });

  /**
   * One project's detail: every run, plus its own model and day breakdowns.
   *
   * A project that has been removed from the list is still answerable — the runs happened and the quota
   * was spent, so its history is reachable rather than orphaned.
   */
  app.get<{ Querystring: { projectId?: string; days?: string } }>(
    '/api/usage/project',
    async (req, reply): Promise<ProjectUsageReport | never> => {
      const projectId = req.query.projectId?.trim();
      if (!projectId) return badRequest(reply, 'A projectId is required.') as never;

      const days = parseDays(req.query.days);
      if (days === null) return badRequest(reply, `days must be one of ${[...ALLOWED_DAYS].join(', ')}.`) as never;

      const current = state.read();
      const project = current.projects.find((p) => p.id === projectId);
      const titles = new Map(current.chats.map((chat) => [chat.id, chat.title]));

      return usage.aggregateProject(usage.read(), {
        projectId,
        days,
        now: Date.now(),
        name: project?.name ?? `${projectId} (removed)`,
        // A chat can be deleted while its runs remain accounted for; say so rather than showing a blank.
        titleOf: (chatId) => titles.get(chatId) ?? 'Deleted chat'
      });
    }
  );

  /**
   * Sessions found in Claude Code's own transcripts, per project.
   *
   * Covers work done outside Flight Deck — a long conversation in a terminal spends the same quota against
   * the same repository, and `usage.jsonl` knows nothing about it. Tokens only: a transcript carries no
   * cost, so these are reported apart from the cost totals rather than priced by guesswork.
   */
  app.get('/api/usage/transcripts', async (): Promise<{ projects: ProjectTranscriptUsage[] }> => {
    const current = state.read();
    const adopted = new Set(current.chats.map((chat) => chat.sessionId));

    const projects = current.projects.map((project) => {
      const sessions = sessionsForProject(project.path);
      return {
        projectId: project.id,
        name: project.name,
        sessions,
        messages: sessions.reduce((sum, session) => sum + session.messages, 0),
        outputTokens: sessions.reduce((sum, session) => sum + session.outputTokens, 0),
        cacheReadTokens: sessions.reduce((sum, session) => sum + session.cacheReadTokens, 0),
        lastAt: sessions[0]?.lastAt ?? null,
        // Lets the UI mark which of these are already chats here, so the two lists reconcile.
        adoptedSessionIds: sessions.filter((s) => adopted.has(s.sessionId)).map((s) => s.sessionId)
      };
    });

    // Busiest first, and projects with no transcripts at all are dropped rather than listed as zeros.
    return { projects: projects.filter((p) => p.sessions.length > 0).sort((a, b) => b.outputTokens - a.outputTokens) };
  });
}
