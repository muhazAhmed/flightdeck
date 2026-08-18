import type { FastifyInstance, FastifyReply } from 'fastify';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GitFile, GitStatus, SkippedPath, StashEntry } from '@shared/types';
import * as state from '../state.js';
import { badRequest, notFound, serverError } from '../errors.js';

/** Resolve a repo handle from a project id. The client never supplies a path — the one
 *  input-validation rule that actually matters here (SPEC, CLAUDE.md rule 5). */
function repoFor(projectId: string | undefined): SimpleGit | null {
  if (!projectId) return null;
  const project = state.findProject(projectId);
  return project ? simpleGit(project.path) : null;
}

/** simple-git reports staged and unstaged state in one flat list with two status
 *  characters per file; split it the way a source-control panel needs to show it. */
function toStatus(raw: StatusResult): GitStatus {
  const staged: GitFile[] = [];
  const unstaged: GitFile[] = [];
  for (const file of raw.files) {
    const index = file.index.trim();
    const working = file.working_dir.trim();
    if (index && index !== '?') staged.push({ path: file.path, status: index });
    if (working && working !== '?') unstaged.push({ path: file.path, status: working });
  }
  return {
    branch: raw.current ?? null,
    tracking: raw.tracking ?? null,
    ahead: raw.ahead,
    behind: raw.behind,
    staged,
    unstaged,
    untracked: raw.not_added.map((path) => ({ path, status: '?' }))
  };
}

/** git's own message is the only useful one — a rewritten "operation failed" would strip
 *  exactly the part the user needs (CLAUDE.md rule 4). */
function detailOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as Error).message).trim();
  return String(err);
}

/**
 * Run a mutation and return the fresh status, so the client never has to fire a second
 * request to find out what changed. A failure carries git's stderr verbatim.
 */
async function mutate(
  reply: FastifyReply,
  git: SimpleGit,
  what: string,
  action: () => Promise<unknown>
): Promise<GitStatus | ReturnType<typeof serverError>> {
  try {
    await action();
    return toStatus(await git.status());
  } catch (err) {
    return serverError(reply, `Could not ${what}.`, detailOf(err));
  }
}

function fileList(body: { files?: unknown } | undefined): string[] | null {
  const files = body?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  if (!files.every((f): f is string => typeof f === 'string' && f.length > 0)) return null;
  return files;
}

interface FilesBody {
  projectId?: string;
  files?: string[];
}

/**
 * Why a path cannot be staged, or null when it can.
 *
 * The case that matters in practice is a nested git repository. `git add` refuses it
 * outright ("does not have a commit checked out"), and because `add` is all-or-nothing
 * that single entry fails the whole batch — pressing "stage all" in a project that
 * contains a nested repo would appear to do nothing at all. Staging it "successfully"
 * would be worse: it would record a gitlink the user never asked for.
 */
function unstageableReason(root: string, path: string): string | null {
  const full = join(root, path);
  try {
    if (!existsSync(full) || !statSync(full).isDirectory()) return null;
  } catch {
    return null;
  }
  if (existsSync(join(full, '.git'))) {
    return 'it is its own git repository — add it as a separate project, or make it a submodule deliberately';
  }
  return null;
}

export async function gitRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>('/api/git/status', async (req, reply) => {
    const git = repoFor(req.query.projectId);
    if (!git) return notFound(reply, 'No such project.');
    try {
      return toStatus(await git.status());
    } catch (err) {
      return serverError(reply, 'Could not read git status.', detailOf(err));
    }
  });

  app.get<{ Querystring: { projectId?: string; file?: string; staged?: string } }>(
    '/api/git/diff',
    async (req, reply) => {
      const git = repoFor(req.query.projectId);
      if (!git) return notFound(reply, 'No such project.');
      const { file, staged } = req.query;
      try {
        const args = staged === 'true' ? ['--staged'] : [];
        if (file) args.push('--', file);
        let diff = await git.diff(args);

        // An untracked file has no diff at all; `--no-index` against the null device
        // renders it as one big addition, which is what the panel wants to show.
        if (!diff && file && staged !== 'true') {
          const status = await git.status();
          if (status.not_added.includes(file)) {
            try {
              diff = await git.raw(['diff', '--no-index', '--', '/dev/null', file]);
            } catch (err) {
              // `git diff --no-index` exits 1 whenever there are differences, and
              // simple-git treats that as a failure — the payload is still on stdout.
              const message = detailOf(err);
              const marker = message.indexOf('diff --git');
              diff = marker >= 0 ? message.slice(marker) : '';
            }
          }
        }
        return { diff };
      } catch (err) {
        return serverError(reply, 'Could not read the diff.', detailOf(err));
      }
    }
  );

  app.post<{ Body: FilesBody }>('/api/git/stage', async (req, reply) => {
    const projectId = req.body?.projectId;
    const project = projectId ? state.findProject(projectId) : undefined;
    const git = repoFor(projectId);
    if (!git || !project) return notFound(reply, 'No such project.');
    const files = fileList(req.body);
    if (!files) return badRequest(reply, 'At least one file is required.');

    const skipped: SkippedPath[] = [];
    const stageable: string[] = [];
    for (const path of files) {
      const reason = unstageableReason(project.path, path);
      if (reason) skipped.push({ path, reason });
      else stageable.push(path);
    }

    if (stageable.length === 0) {
      const first = skipped[0];
      return badRequest(
        reply,
        first ? `Cannot stage ${first.path} — ${first.reason}.` : 'Nothing to stage.',
        'UNSTAGEABLE'
      );
    }

    try {
      await git.add(stageable);
      return { status: toStatus(await git.status()), skipped };
    } catch (err) {
      return serverError(reply, 'Could not stage those files.', detailOf(err));
    }
  });

  app.post<{ Body: FilesBody }>('/api/git/unstage', async (req, reply) => {
    const git = repoFor(req.body?.projectId);
    if (!git) return notFound(reply, 'No such project.');
    const files = fileList(req.body);
    if (!files) return badRequest(reply, 'At least one file is required.');
    // `restore --staged` rather than `reset`: it only touches the index, never the
    // working tree, so an unstage can't discard the user's edits.
    return mutate(reply, git, 'unstage those files', () => git.raw(['restore', '--staged', '--', ...files]));
  });

  app.post<{ Body: FilesBody }>('/api/git/discard', async (req, reply) => {
    const git = repoFor(req.body?.projectId);
    if (!git) return notFound(reply, 'No such project.');
    const files = fileList(req.body);
    if (!files) return badRequest(reply, 'At least one file is required.');

    // The only destructive route in the app. The UI must name each file in its
    // confirmation; there is no undo for this once it runs.
    return mutate(reply, git, 'discard those changes', async () => {
      const status = await git.status();
      const untracked = files.filter((f) => status.not_added.includes(f));
      const tracked = files.filter((f) => !untracked.includes(f));
      if (tracked.length > 0) await git.raw(['restore', '--worktree', '--', ...tracked]);
      // `restore` does not remove untracked files; `clean -f` is the only way.
      if (untracked.length > 0) await git.raw(['clean', '-f', '--', ...untracked]);
    });
  });

  app.post<{ Body: { projectId?: string; message?: string; files?: string[] } }>(
    '/api/git/commit',
    async (req, reply) => {
      const git = repoFor(req.body?.projectId);
      if (!git) return notFound(reply, 'No such project.');
      const message = req.body?.message?.trim();
      if (!message) return badRequest(reply, 'A commit message is required.');

      const files = fileList(req.body);
      try {
        const status = await git.status();
        if (!files && status.staged.length === 0) {
          return badRequest(reply, 'Nothing is staged.', 'NOTHING_STAGED');
        }
        const result = files ? await git.commit(message, files) : await git.commit(message);
        return { commit: result.commit, summary: result.summary, status: toStatus(await git.status()) };
      } catch (err) {
        return serverError(reply, 'Could not commit.', detailOf(err));
      }
    }
  );

  app.get<{ Querystring: { projectId?: string } }>('/api/git/stash-list', async (req, reply) => {
    const git = repoFor(req.query.projectId);
    if (!git) return notFound(reply, 'No such project.');
    try {
      // A tab-separated custom format is parsed reliably; the default `stash list` output
      // mixes the branch name into the subject and needs guessing apart.
      const raw = await git.raw(['stash', 'list', '--format=%gd%x09%gs%x09%cr']);
      const entries: StashEntry[] = raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
          const [ref, subject, when] = line.split('\t');
          return {
            index,
            ref: ref ?? `stash@{${index}}`,
            subject: subject ?? '',
            when: when ?? ''
          };
        });
      return entries;
    } catch (err) {
      return serverError(reply, 'Could not list stashes.', detailOf(err));
    }
  });

  app.post<{ Body: { projectId?: string; message?: string; includeUntracked?: boolean } }>(
    '/api/git/stash',
    async (req, reply) => {
      const git = repoFor(req.body?.projectId);
      if (!git) return notFound(reply, 'No such project.');
      const args = ['push'];
      if (req.body?.includeUntracked) args.push('--include-untracked');
      const message = req.body?.message?.trim();
      if (message) args.push('-m', message);
      return mutate(reply, git, 'stash your changes', () => git.stash(args));
    }
  );

  app.post<{ Body: { projectId?: string; index?: number } }>('/api/git/stash-pop', async (req, reply) => {
    const git = repoFor(req.body?.projectId);
    if (!git) return notFound(reply, 'No such project.');
    const index = req.body?.index ?? 0;
    if (!Number.isInteger(index) || index < 0) return badRequest(reply, 'Invalid stash index.');
    return mutate(reply, git, 'pop that stash', () => git.stash(['pop', `stash@{${index}}`]));
  });
}
