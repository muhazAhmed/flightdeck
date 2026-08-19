/**
 * Per-project cost, tokens and quota.
 *
 * Reads the append-only log written as each run finishes. No agent, no network — arithmetic over a
 * file, so it stays instant however long the log gets.
 */
import type { FastifyInstance } from 'fastify';
import type { ProjectUsageReport, UsageReport } from '@shared/types';
import * as state from '../state.js';
import * as usage from '../usage.js';
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
}
