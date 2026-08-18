/**
 * Branch listing, checkout, creation and deletion.
 *
 * All of it human-initiated, like commit and push: no agent-reachable path touches this
 * file. The agent works in whatever branch you left checked out, which is exactly why being
 * able to create one *before* setting it going is worth having in the tool rather than in a
 * terminal you have to remember to visit.
 *
 * Guarded, in the sense that matters: a checkout that would discard or drag along
 * uncommitted work is refused with the reason, rather than attempted and half-completed.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { BranchInfo, BranchList } from '@shared/types';
import { messageOf, runGit } from '../git-exec.js';
import * as state from '../state.js';
import { badRequest, notFound, serverError } from '../errors.js';
import { readStatus } from './status.js';

function pathFor(projectId: string | undefined): string | null {
  if (!projectId) return null;
  return state.findProject(projectId)?.path ?? null;
}

/**
 * git allows almost anything in a ref name, but the characters it forbids are forbidden for
 * good reasons, and a name that fails `check-ref-format` produces a confusing error deep in
 * the plumbing. Reject the obvious cases up front with a sentence the user can act on.
 */
function invalidBranchName(name: string): string | null {
  if (!name) return 'A branch name is required.';
  if (/\s/.test(name)) return 'Branch names cannot contain spaces.';
  if (/^[-.]/.test(name)) return 'Branch names cannot start with a dash or a dot.';
  if (/\.\.|[~^:?*[\\]|@\{|\/\/|\.lock$|\/$/.test(name)) {
    return 'That name contains characters git does not allow in a branch (.. ~ ^ : ? * [ \\ @{).';
  }
  return null;
}

/**
 * Parse `git branch --all --format=…` (tab-separated; the default output folds the
 * current-branch marker into the name column and has to be unpicked).
 *
 * Local and remote are told apart by the FULL refname — `refs/heads/…` versus
 * `refs/remotes/…`. The short form cannot do it: `%(refname:short)` renders a remote branch
 * as `origin/main`, which is indistinguishable from a local branch whose name contains a
 * slash. Relying on the short form listed `origin/main` among the branches you could check
 * out directly, which would have left a detached HEAD.
 */
export function parseBranchList(stdout: string): BranchList {
  const local: BranchInfo[] = [];
  const remote: string[] = [];
  let current: string | null = null;

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [head, fullRef, shortRef, upstream, subject, when] = line.split('\t');
    if (!fullRef || !shortRef) continue;

    if (fullRef.startsWith('refs/remotes/')) {
      // `origin/HEAD` is a symbolic pointer, not a branch anyone checks out.
      if (!shortRef.endsWith('/HEAD')) remote.push(shortRef);
      continue;
    }
    // Tags and any other ref namespace are not branches.
    if (!fullRef.startsWith('refs/heads/')) continue;

    const isCurrent = head === '*';
    if (isCurrent) current = shortRef;
    local.push({
      name: shortRef,
      current: isCurrent,
      upstream: upstream || null,
      subject: subject || '',
      when: when || ''
    });
  }

  return { current, local, remote };
}

async function list(reply: FastifyReply, cwd: string) {
  const result = await runGit(cwd, [
    'branch',
    '--all',
    // %(HEAD) is '*' for the checked-out branch. Both refname forms are requested: the full
    // one classifies local vs remote, the short one is what a human reads. The rest is
    // metadata so branches can be told apart by their last commit.
    '--format=%(HEAD)%09%(refname)%09%(refname:short)%09%(upstream:short)%09%(contents:subject)%09%(committerdate:relative)'
  ]);
  if (!result.ok) return serverError(reply, 'Could not list branches.', messageOf(result));
  return parseBranchList(result.stdout);
}

export async function branchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>('/api/git/branches', async (req, reply) => {
    const cwd = pathFor(req.query.projectId);
    if (!cwd) return notFound(reply, 'No such project.');
    return list(reply, cwd);
  });

  app.post<{ Body: { projectId?: string; branch?: string } }>('/api/git/checkout', async (req, reply) => {
    const cwd = pathFor(req.body?.projectId);
    if (!cwd) return notFound(reply, 'No such project.');
    const branch = req.body?.branch?.trim();
    if (!branch) return badRequest(reply, 'A branch is required.');

    const status = await readStatus(cwd);
    if (!status) return serverError(reply, 'Could not read git status.');
    if (status.branch === branch) return badRequest(reply, `Already on ${branch}.`, 'ALREADY_ON_BRANCH');

    // Refuse rather than carry changes across. git would happily bring uncommitted edits
    // along, which is how work ends up committed to the wrong branch — the exact mistake
    // this panel exists to prevent.
    if (status.staged.length + status.unstaged.length > 0) {
      return badRequest(
        reply,
        'The working tree has uncommitted changes. Commit or stash them before switching branches.',
        'GIT_DIRTY'
      );
    }

    // A remote-only branch needs a local tracking branch; `checkout <remote>/<name>` alone
    // would leave a detached HEAD.
    const isRemoteOnly = branch.includes('/') && !(await localExists(cwd, branch));
    const args = isRemoteOnly
      ? ['checkout', '--track', branch]
      : ['checkout', branch];

    const result = await runGit(cwd, args);
    if (!result.ok) return serverError(reply, `Could not switch to ${branch}.`, messageOf(result));

    const after = await readStatus(cwd);
    return { summary: messageOf(result) || `Switched to ${branch}.`, status: after, branches: await list(reply, cwd) };
  });

  app.post<{ Body: { projectId?: string; branch?: string; from?: string } }>(
    '/api/git/branch',
    async (req, reply) => {
      const cwd = pathFor(req.body?.projectId);
      if (!cwd) return notFound(reply, 'No such project.');
      const branch = req.body?.branch?.trim() ?? '';
      const invalid = invalidBranchName(branch);
      if (invalid) return badRequest(reply, invalid, 'BAD_BRANCH_NAME');

      // Creating a branch does NOT require a clean tree: `checkout -b` carries the working
      // tree onto the new branch, which is usually exactly what someone wants when they
      // realise mid-edit that this should not be on main.
      const from = req.body?.from?.trim();
      const args = from ? ['checkout', '-b', branch, from] : ['checkout', '-b', branch];
      const result = await runGit(cwd, args);
      if (!result.ok) return serverError(reply, `Could not create ${branch}.`, messageOf(result));

      return {
        summary: from ? `Created ${branch} from ${from}.` : `Created ${branch}.`,
        status: await readStatus(cwd),
        branches: await list(reply, cwd)
      };
    }
  );

  app.delete<{ Params: { branch: string }; Querystring: { projectId?: string; force?: string } }>(
    '/api/git/branch/:branch',
    async (req, reply) => {
      const cwd = pathFor(req.query.projectId);
      if (!cwd) return notFound(reply, 'No such project.');
      const branch = decodeURIComponent(req.params.branch);

      const status = await readStatus(cwd);
      if (status?.branch === branch) {
        return badRequest(reply, `${branch} is checked out. Switch away before deleting it.`, 'CURRENT_BRANCH');
      }

      // `-d` refuses to delete a branch whose commits are not merged anywhere; that refusal
      // is a feature. Force is opt-in per call and surfaced in the UI as a second, explicit
      // confirmation — never the default retry.
      const flag = req.query.force === 'true' ? '-D' : '-d';
      const result = await runGit(cwd, ['branch', flag, branch]);
      if (!result.ok) {
        const detail = messageOf(result);
        const unmerged = /not fully merged/i.test(detail);
        return unmerged
          ? badRequest(reply, `${branch} has commits that are not merged anywhere.`, 'UNMERGED')
          : serverError(reply, `Could not delete ${branch}.`, detail);
      }

      return { summary: messageOf(result) || `Deleted ${branch}.`, branches: await list(reply, cwd) };
    }
  );
}

/** Does a local branch of this name already exist? Decides whether a `remote/name` checkout
 *  needs `--track`. */
async function localExists(cwd: string, name: string): Promise<boolean> {
  const result = await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
  return result.ok;
}
