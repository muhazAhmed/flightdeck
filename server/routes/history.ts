/**
 * Commit history: the log, one commit's files, and one file's diff within a commit.
 *
 * Read-only throughout. Nothing here checks out, reverts or resets — looking back at what you committed is a
 * different act from changing it, and the second one belongs in a terminal (see the safety model in SPEC.md).
 *
 * EVERY VALUE FROM THE CLIENT IS SHAPE-CHECKED before it becomes a git argument. A sha is hex or it is
 * rejected, and a path is passed after `--` so it can never be read as an option. The project path itself
 * still comes from `projectId` server-side, as everywhere else.
 */
import type { FastifyInstance } from 'fastify';
import type { CommitDetail, CommitFile, HistoryCommit } from '@shared/types';
import { messageOf, runGit } from '../git-exec.js';
import * as state from '../state.js';
import { badRequest, notFound, serverError } from '../errors.js';

/** Field separator inside a log line, built from its code point so the source stays readable. */
const UNIT = String.fromCharCode(31);

/** One page of history. Enough to scroll, small enough that a 40,000-commit repository stays instant. */
const PAGE = 50;
const MAX_PAGE = 200;

/** A sha is hex and nothing else — this string is about to be a git argument. */
const SHA = /^[0-9a-f]{4,40}$/;

const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%ae', '%cI', '%D', '%p'].join('%x1f');

function parseLog(stdout: string): HistoryCommit[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, author, email, at, refs, parents] = line.split(UNIT);
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        subject: subject ?? '',
        author: author ?? '',
        email: email ?? '',
        at: at ?? '',
        // `%D` is "HEAD -> main, tag: v1"; the arrow half is noise once we know the ref names.
        refs: (refs ?? '')
          .split(',')
          .map((ref) => ref.replace('HEAD ->', '').replace('tag:', '').trim())
          .filter(Boolean),
        parents: (parents ?? '').trim().split(/\s+/).filter(Boolean).length
      };
    })
    .filter((commit) => commit.sha.length > 0);
}

/**
 * `--numstat` output, one line per file.
 *
 * Binary files report `-` rather than a count, which parses to 0 rather than NaN. A rename arrives as
 * `old => new` or with the shared prefix factored out, so the raw path is kept as `from` and the new one used
 * as the identity.
 */
function parseNumstat(stdout: string): CommitFile[] {
  const files: CommitFile[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [added, removed, rest] = line.split('\t');
    if (rest === undefined) continue;

    let path = rest;
    let from: string | undefined;
    // `dir/{old => new}.ts` and `old.ts => new.ts` are both possible.
    const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rest);
    if (braced) {
      from = `${braced[1]}${braced[2]}${braced[4]}`.replace(/\/\//g, '/');
      path = `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, '/');
    } else if (rest.includes(' => ')) {
      const [oldPath, newPath] = rest.split(' => ');
      from = oldPath;
      path = newPath ?? rest;
    }

    files.push({
      path,
      status: from ? 'R' : '?',
      insertions: Number(added) || 0,
      deletions: Number(removed) || 0,
      ...(from ? { from } : {})
    });
  }
  return files;
}

/** `--name-status` fills in the letter `--numstat` does not report. */
function applyStatuses(files: CommitFile[], stdout: string): CommitFile[] {
  const statuses = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const letter = (parts[0] ?? '').charAt(0);
    // A rename line is `R100<TAB>old<TAB>new`; the last column is always the current path.
    const path = parts[parts.length - 1];
    if (letter && path) statuses.set(path, letter);
  }
  return files.map((file) => ({ ...file, status: statuses.get(file.path) ?? file.status }));
}

function pathFor(projectId: string | undefined): string | null {
  if (!projectId) return null;
  return state.findProject(projectId)?.path ?? null;
}

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Recent commits, newest first.
   *
   * `skip` rather than a cursor: git counts from HEAD, the list only grows at the top, and a commit added
   * while someone scrolls shifts the window by one — which is a duplicate row, not a lost one.
   */
  app.get<{ Querystring: { projectId?: string; limit?: string; skip?: string } }>(
    '/api/git/log',
    async (req, reply) => {
      const cwd = pathFor(req.query.projectId);
      if (!cwd) return notFound(reply, 'No such project.');

      const limit = Math.min(MAX_PAGE, Math.max(1, Number(req.query.limit) || PAGE));
      const skip = Math.max(0, Number(req.query.skip) || 0);

      // One extra row answers "is there more" without a second count over the whole history.
      const result = await runGit(cwd, [
        'log',
        `--format=${LOG_FORMAT}`,
        `--max-count=${limit + 1}`,
        `--skip=${skip}`
      ]);

      if (!result.ok) {
        // An empty repository has no HEAD; that is "no commits yet", not a failure.
        if (/does not have any commits yet|unknown revision/i.test(messageOf(result))) {
          return { commits: [], hasMore: false };
        }
        return serverError(reply, 'Could not read the history.', messageOf(result));
      }

      const commits = parseLog(result.stdout);
      return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
    }
  );

  /** One commit: its message body and the files it touched, with per-file counts. */
  app.get<{ Querystring: { projectId?: string; sha?: string } }>('/api/git/commit', async (req, reply) => {
    const cwd = pathFor(req.query.projectId);
    if (!cwd) return notFound(reply, 'No such project.');

    const sha = req.query.sha?.trim().toLowerCase() ?? '';
    if (!SHA.test(sha)) return badRequest(reply, 'That is not a commit id.', 'BAD_SHA');

    // The body is fetched separately rather than appended to the same format string: a commit message can
    // contain anything, including the separator, and splitting one string four ways is how that becomes a bug.
    const [meta, body, numstat, nameStatus] = await Promise.all([
      runGit(cwd, ['show', '--no-patch', `--format=${LOG_FORMAT}`, sha]),
      runGit(cwd, ['show', '--no-patch', '--format=%b', sha]),
      runGit(cwd, ['show', '--numstat', '--format=', sha]),
      runGit(cwd, ['show', '--name-status', '--format=', sha])
    ]);

    if (!meta.ok) return serverError(reply, 'Could not read that commit.', messageOf(meta));

    const commit = parseLog(meta.stdout)[0];
    if (!commit) return serverError(reply, 'Could not read that commit.', 'The log line could not be parsed.');

    const files = applyStatuses(numstat.ok ? parseNumstat(numstat.stdout) : [], nameStatus.ok ? nameStatus.stdout : '');
    const detail: CommitDetail = {
      ...commit,
      body: body.ok ? body.stdout.trim() : '',
      files,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    };
    return detail;
  });

  /**
   * One file's diff inside one commit.
   *
   * The path goes after `--`, so a file named `--output=x` is a path and not a flag. A merge commit needs
   * `-m` or it prints nothing at all, which reads as "no changes" rather than "this is a merge".
   */
  app.get<{ Querystring: { projectId?: string; sha?: string; path?: string } }>(
    '/api/git/commit-diff',
    async (req, reply) => {
      const cwd = pathFor(req.query.projectId);
      if (!cwd) return notFound(reply, 'No such project.');

      const sha = req.query.sha?.trim().toLowerCase() ?? '';
      if (!SHA.test(sha)) return badRequest(reply, 'That is not a commit id.', 'BAD_SHA');

      const path = req.query.path?.trim();
      if (!path) return badRequest(reply, 'A file path is required.');

      const result = await runGit(cwd, [
        'show',
        '--format=',
        '--first-parent',
        '-m',
        sha,
        '--',
        path
      ]);
      if (!result.ok) return serverError(reply, 'Could not read that diff.', messageOf(result));
      return { diff: result.stdout };
    }
  );
}
