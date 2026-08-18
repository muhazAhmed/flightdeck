/**
 * Fetch, pull, and push.
 *
 * ON PUSH: SPEC says the *agent* never pushes, and that still holds — no agent-facing path
 * reaches this file. But a human clicking a button in their own UI is a different act, and
 * refusing to offer it just sends the user to a terminal to do the same thing with less
 * information in front of them. So push is here, and it is deliberately narrow:
 *
 *   - human-initiated only, always behind a confirmation naming remote, branch and count
 *   - never `--force`, in any spelling; there is no flag and no route that accepts one
 *   - never `--all`; the remote and branch come from the repository's own config, never
 *     from the request body
 *
 * Every command runs through `runGit` rather than simple-git — see git-exec.ts for why.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GitStatus } from '@shared/types';
import { messageOf, runGit } from '../git-exec.js';
import * as state from '../state.js';
import { badRequest, notFound, serverError } from '../errors.js';
import { readStatus } from './status.js';

interface Target {
  path: string;
}

function projectPath(projectId: string | undefined): Target | null {
  if (!projectId) return null;
  const project = state.findProject(projectId);
  return project ? { path: project.path } : null;
}

async function respond(
  reply: FastifyReply,
  cwd: string,
  what: string,
  summary: string
): Promise<{ summary: string; status: GitStatus } | ReturnType<typeof serverError>> {
  const status = await readStatus(cwd);
  if (!status) return serverError(reply, `${what} succeeded but the status could not be re-read.`);
  return { summary, status };
}

export async function remoteRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { projectId?: string } }>('/api/git/fetch', async (req, reply) => {
    const target = projectPath(req.body?.projectId);
    if (!target) return notFound(reply, 'No such project.');

    const result = await runGit(target.path, ['fetch', '--prune']);
    if (!result.ok) return serverError(reply, 'Could not fetch.', messageOf(result));
    // git says nothing at all when there was nothing to bring down.
    const summary = messageOf(result) || 'Already up to date.';
    return respond(reply, target.path, 'Fetch', summary);
  });

  app.post<{ Body: { projectId?: string } }>('/api/git/pull', async (req, reply) => {
    const target = projectPath(req.body?.projectId);
    if (!target) return notFound(reply, 'No such project.');

    const status = await readStatus(target.path);
    if (!status) return serverError(reply, 'Could not read git status.');

    // Pulling into a dirty tree is how people lose work to a merge they did not expect.
    // Refuse and say so; stash is one button away.
    if (status.staged.length + status.unstaged.length > 0) {
      return badRequest(
        reply,
        'The working tree has uncommitted changes. Commit or stash them before pulling.',
        'GIT_DIRTY'
      );
    }
    if (!status.tracking) {
      return badRequest(reply, `${status.branch ?? 'This branch'} has no upstream to pull from.`, 'NO_UPSTREAM');
    }

    // `--ff-only`: bring the branch up to date or refuse. Never invent a merge commit.
    const result = await runGit(target.path, ['pull', '--ff-only']);
    if (!result.ok) return serverError(reply, 'Could not pull.', messageOf(result));
    return respond(reply, target.path, 'Pull', messageOf(result) || 'Already up to date.');
  });

  app.post<{ Body: { projectId?: string } }>('/api/git/push', async (req, reply) => {
    const target = projectPath(req.body?.projectId);
    if (!target) return notFound(reply, 'No such project.');

    const status = await readStatus(target.path);
    if (!status) return serverError(reply, 'Could not read git status.');
    if (!status.branch) return badRequest(reply, 'No branch is checked out.', 'DETACHED');

    const remotes = await runGit(target.path, ['remote']);
    const names = remotes.stdout.split('\n').map((n) => n.trim()).filter(Boolean);
    const remote = names.includes('origin') ? 'origin' : names[0];
    if (!remote) return badRequest(reply, 'This repository has no remote configured.', 'NO_REMOTE');

    // A branch with no upstream needs `-u` once; afterwards a plain push is enough.
    const args = status.tracking
      ? ['push', remote, status.branch]
      : ['push', '--set-upstream', remote, status.branch];

    const result = await runGit(target.path, args);
    if (!result.ok) return serverError(reply, 'Could not push.', messageOf(result));

    const lines = [messageOf(result) || `Pushed ${status.branch} to ${remote}.`];
    if (!status.tracking) lines.push(`Upstream set to ${remote}/${status.branch}.`);
    return respond(reply, target.path, 'Push', lines.join('\n'));
  });
}
