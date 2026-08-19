/**
 * Fetch, pull, push, and the build trigger.
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

/** The message the trigger commit carries. Fixed, so it is recognisable in a log and in CI. */
const TRIGGER_MESSAGE = 'trigger build';

type PushOutcome =
  | { ok: true; summary: string }
  | { ok: false; message: string; code: string; detail?: string };

function projectPath(projectId: string | undefined): Target | null {
  if (!projectId) return null;
  const project = state.findProject(projectId);
  return project ? { path: project.path } : null;
}

/**
 * Push the checked-out branch to its own remote.
 *
 * Shared by the Push button and the build trigger so there is exactly one push implementation to
 * audit: no `--force` in any spelling, no `--all`, and both remote and branch read from the
 * repository rather than from the request.
 */
async function pushCurrentBranch(cwd: string, status: GitStatus): Promise<PushOutcome> {
  if (!status.branch) return { ok: false, message: 'No branch is checked out.', code: 'DETACHED' };

  const remotes = await runGit(cwd, ['remote']);
  const names = remotes.stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const remote = names.includes('origin') ? 'origin' : names[0];
  if (!remote) return { ok: false, message: 'This repository has no remote configured.', code: 'NO_REMOTE' };

  // A branch with no upstream needs `-u` once; afterwards a plain push is enough.
  const args = status.tracking
    ? ['push', remote, status.branch]
    : ['push', '--set-upstream', remote, status.branch];

  const result = await runGit(cwd, args);
  if (!result.ok) {
    return { ok: false, message: 'Could not push.', code: 'PUSH_FAILED', detail: messageOf(result) };
  }

  const lines = [messageOf(result) || `Pushed ${status.branch} to ${remote}.`];
  if (!status.tracking) lines.push(`Upstream set to ${remote}/${status.branch}.`);
  return { ok: true, summary: lines.join('\n') };
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

    const outcome = await pushCurrentBranch(target.path, status);
    if (!outcome.ok) {
      return outcome.code === 'PUSH_FAILED'
        ? serverError(reply, outcome.message, outcome.detail)
        : badRequest(reply, outcome.message, outcome.code, outcome.detail);
    }
    return respond(reply, target.path, 'Push', outcome.summary);
  });

  /**
   * An empty commit, then a push — the CI trigger.
   *
   * Some pipelines only run on a new commit, and re-running one by hand from a web UI is slower than
   * pressing a button here. Nothing about the safety model changes: human-initiated, never forced,
   * and the remote and branch still come from the repository's own config.
   *
   * THE GUARD THAT MATTERS: `git commit --allow-empty` does not mean "commit nothing" — it commits
   * whatever is in the index. With files staged, this button would quietly ship them under the
   * message "trigger build". A staged index is therefore refused, and the refusal names the files.
   */
  app.post<{ Body: { projectId?: string } }>('/api/git/trigger-build', async (req, reply) => {
    const target = projectPath(req.body?.projectId);
    if (!target) return notFound(reply, 'No such project.');

    const status = await readStatus(target.path);
    if (!status) return serverError(reply, 'Could not read git status.');
    if (!status.branch) return badRequest(reply, 'No branch is checked out.', 'DETACHED');

    if (status.staged.length > 0) {
      const count = status.staged.length;
      return badRequest(
        reply,
        `${count} file${count === 1 ? ' is' : 's are'} staged — an empty commit would carry ${count === 1 ? 'it' : 'them'} along under the message "${TRIGGER_MESSAGE}".`,
        'GIT_STAGED',
        ['Commit or unstage first:', ...status.staged.map((file) => file.path)].join('\n')
      );
    }

    // Unstaged and untracked files are left alone: an empty commit does not touch the working tree.
    const commit = await runGit(target.path, ['commit', '--allow-empty', '-m', TRIGGER_MESSAGE]);
    if (!commit.ok) return serverError(reply, 'Could not create the empty commit.', messageOf(commit));

    const head = await runGit(target.path, ['rev-parse', '--short', 'HEAD']);
    const sha = head.ok ? head.stdout.trim() : 'HEAD';

    const outcome = await pushCurrentBranch(target.path, status);
    if (!outcome.ok) {
      // The commit exists locally now. Reporting only "could not push" would leave the user unsure
      // whether anything happened — and pressing the button again would stack empty commits.
      return serverError(
        reply,
        `Empty commit ${sha} was created, but the push failed — nothing was triggered.`,
        [
          outcome.detail ?? outcome.message,
          '',
          `The commit is on ${status.branch} locally. Push it when the remote is reachable, or remove it with: git reset --hard HEAD~1`
        ].join('\n')
      );
    }

    return respond(reply, target.path, 'Trigger', [`Empty commit ${sha} pushed.`, outcome.summary].join('\n'));
  });
}
