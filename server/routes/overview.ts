/**
 * The deck: every project's state in one response.
 *
 * WHY THIS EXISTS AT ALL. Everything else in Flight Deck could be done by an editor with enough
 * windows open. This cannot: an editor window knows about one workspace, so "which of my twenty repos
 * have uncommitted work, and how long has it been sitting?" is a question you answer by opening twenty
 * windows. One process that already holds every project can answer it in a second.
 *
 * No agent is involved and no tokens are spent. It is git and the filesystem.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Project, ProjectOverview } from '@shared/types';
import { runGit } from '../git-exec.js';
import * as state from '../state.js';
import { readStatus } from './status.js';

/**
 * How many repositories are read at once.
 *
 * Each one costs two git spawns, and spawning is the expensive part on Windows. Six keeps twenty repos
 * near a second without turning the machine over to process creation — a serial loop took noticeably
 * longer, and unbounded parallelism spawns forty processes at once for no gain.
 */
const CONCURRENCY = 6;

/** A wedged repository (a stale lock, a network drive) must not hold the whole deck up. */
const GIT_TIMEOUT_MS = 5000;

/** A fetch talks to a server, so it gets longer than a local read — but not forever. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Statting every changed file in a huge working tree is wasted work — the age of the oldest change is
 * a hint, not an audit, and it is the same hint whether it came from 40 files or 4000.
 */
const MAX_FILES_STATTED = 200;

/**
 * Field separator for `git log --format`.
 *
 * A unit separator rather than a comma or a pipe, because a commit subject can contain either. Built
 * from its code point so the source stays readable — an invisible 0x1f in a string literal is the kind
 * of character an editor or a patch quietly eats.
 */
const UNIT_SEPARATOR = String.fromCharCode(31);

/**
 * When the oldest uncommitted change was made.
 *
 * The OLDEST rather than the newest deliberately: newest tells you when you last saved, which you
 * already know. Oldest tells you this repo has had work sitting in it since Tuesday, which is the thing
 * you would otherwise forget.
 *
 * A file listed by git but missing on disk (deleted, or a rename's old path) is skipped rather than
 * treated as an error.
 */
function oldestChangeAt(cwd: string, paths: string[]): string | null {
  let oldest: number | null = null;
  for (const relative of paths.slice(0, MAX_FILES_STATTED)) {
    try {
      const { mtimeMs } = statSync(join(cwd, relative));
      if (oldest === null || mtimeMs < oldest) oldest = mtimeMs;
    } catch {
      /* deleted, or the old half of a rename */
    }
  }
  return oldest === null ? null : new Date(oldest).toISOString();
}

async function summarise(project: Project, lastAgentRunAt: string | null): Promise<ProjectOverview> {
  const base: ProjectOverview = {
    projectId: project.id,
    name: project.name,
    path: project.path,
    missing: false,
    branch: null,
    tracking: null,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    lastCommitSubject: null,
    lastCommitAt: null,
    dirtySince: null,
    lastAgentRunAt,
    error: null
  };

  // A project whose folder was moved or deleted is a real state the deck should show, not an error to
  // swallow — otherwise the card silently reads as "clean".
  if (!existsSync(project.path) || !existsSync(join(project.path, '.git'))) {
    return { ...base, missing: true, error: 'The folder is gone, or is no longer a git repository.' };
  }

  const [status, log] = await Promise.all([
    readStatus(project.path),
    // %s subject, %cI committer date in strict ISO. One spawn, both facts.
    runGit(project.path, ['log', '-1', '--format=%s%x1f%cI'], GIT_TIMEOUT_MS)
  ]);

  if (!status) return { ...base, error: 'Could not read git status.' };

  const changed = [...status.staged, ...status.unstaged, ...status.untracked].map((file) => file.path);

  // An empty repository has no HEAD, so a failing log is normal rather than an error.
  let lastCommitSubject: string | null = null;
  let lastCommitAt: string | null = null;
  if (log.ok) {
    const [subject, date] = log.stdout.trim().split(UNIT_SEPARATOR);
    lastCommitSubject = subject?.trim() || null;
    lastCommitAt = date?.trim() || null;
  }

  return {
    ...base,
    branch: status.branch,
    tracking: status.tracking,
    ahead: status.ahead,
    behind: status.behind,
    stagedCount: status.staged.length,
    unstagedCount: status.unstaged.length,
    untrackedCount: status.untracked.length,
    lastCommitSubject,
    lastCommitAt,
    dirtySince: changed.length > 0 ? oldestChangeAt(project.path, changed) : null
  };
}

/** Run `work` over `items`, at most `limit` at a time, preserving input order in the result. */
async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function overviewRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Fetch every project, then report the deck.
   *
   * Ahead/behind is measured against local remote refs, so on a deck that has not fetched today every
   * card honestly reads 0/0 — which looks like "nothing to push" and is the one number here that can
   * mislead. Twenty fetches from one button is the cross-repo action an editor has no place to put.
   *
   * Read-only on the remote, so it needs no confirmation. Failures are counted rather than thrown: a
   * repository whose remote is unreachable should cost its own card's accuracy, nothing more.
   */
  app.post('/api/overview/fetch', async (): Promise<{ fetched: number; failed: number }> => {
    const projects = state.read().projects;
    const results = await pooled(projects, CONCURRENCY, async (project) => {
      if (!existsSync(project.path)) return false;
      const result = await runGit(project.path, ['fetch', '--prune'], FETCH_TIMEOUT_MS);
      return result.ok;
    });
    const fetched = results.filter(Boolean).length;
    return { fetched, failed: results.length - fetched };
  });

  app.get('/api/overview', async (): Promise<{ projects: ProjectOverview[]; readAt: string }> => {
    const current = state.read();

    /** Most recent message across a project's chats — "when an agent last worked here". */
    const lastRunFor = (projectId: string): string | null => {
      const times = current.chats
        .filter((chat) => chat.projectId === projectId)
        .map((chat) => chat.lastMessageAt)
        .filter((at): at is string => at !== null);
      if (times.length === 0) return null;
      return times.reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest));
    };

    const projects = await pooled(current.projects, CONCURRENCY, (project) =>
      summarise(project, lastRunFor(project.id)).catch(
        // One unreadable repository must not cost the other nineteen their card.
        (err): ProjectOverview => ({
          projectId: project.id,
          name: project.name,
          path: project.path,
          missing: false,
          branch: null,
          tracking: null,
          ahead: 0,
          behind: 0,
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          lastCommitSubject: null,
          lastCommitAt: null,
          dirtySince: null,
          lastAgentRunAt: lastRunFor(project.id),
          error: err instanceof Error ? err.message : String(err)
        })
      )
    );

    return { projects, readAt: new Date().toISOString() };
  });
}
