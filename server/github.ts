/**
 * The GitHub side of a project: which repository it is, and what is open against it.
 *
 * THE REPOSITORY COMES FROM THE PROJECT, NOT FROM THE ACCOUNT. Each project has an `origin`, and that is what
 * decides which pull requests to show. The alternative — listing every repository the signed-in account can
 * see — would be a worse github.com, mostly full of repositories you have no local copy of and therefore
 * cannot review a diff of.
 *
 * Everything here goes through `gh`, which owns the auth. This module never sees a token.
 */
import type { Project, PullRequest, RepoRef } from '@shared/types';
import { runGit } from './git-exec.js';
import { probe } from './tools.js';

/** A network call to GitHub, so longer than a local git read — but not forever. */
const LIST_TIMEOUT_MS = 20_000;

/** Fetching a pull request talks to the remote, so it gets longer than a local read. */
const FETCH_TIMEOUT_MS = 60_000;

/** Enough to see what is open. A repository with more than this open has a different problem. */
const LIST_LIMIT = 50;

const FIELDS = [
  'number',
  'title',
  'author',
  'headRefName',
  'baseRefName',
  'isDraft',
  'reviewDecision',
  'additions',
  'deletions',
  'changedFiles',
  'updatedAt',
  'url'
].join(',');

/**
 * Read `owner/repo` out of a remote URL.
 *
 * Every shape git accepts, because people clone differently and a project imported from an SSH clone is not a
 * different feature: an `https` clone, the scp-like `git@host:owner/repo.git`, an `ssh://` clone, and any of
 * them with credentials in front, a port, or `.git` missing from the end. The exact strings are in the test —
 * a full URL in a comment here would trip the portability rule, which is right to be blunt about it.
 *
 * `host` is kept rather than assumed to be github.com — an enterprise install is the same shape, and `gh`
 * takes `HOST/OWNER/REPO`.
 */
export function parseRemote(url: string): RepoRef | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;

  // scp-like: git@host:owner/repo.git — not a URL, so it is matched before anything tries to parse it as one.
  const scp = /^[^@/]+@([^:]+):(.+)$/.exec(trimmed);
  const rest = scp ? scp[2] : null;
  if (scp?.[1] && rest) return build(scp[1], rest);

  const url_ = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  if (url_?.[1] && url_[2]) return build(url_[1], url_[2]);
  return null;
}

function build(host: string, path: string): RepoRef | null {
  const parts = path
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  // The last two segments: a self-hosted install can serve from a sub-path.
  if (parts.length < 2) return null;
  const repo = parts[parts.length - 1] as string;
  const owner = parts[parts.length - 2] as string;
  return { host: host.toLowerCase(), owner, repo, isGitHub: host.toLowerCase().endsWith('github.com') };
}

/** Which repository this project pushes to, or null when it has no `origin` at all. */
export async function repoFor(project: Project): Promise<RepoRef | null> {
  const remote = await runGit(project.path, ['remote', 'get-url', 'origin'], 5000);
  if (!remote.ok) return null;
  return parseRemote(remote.stdout);
}

export interface PullsAnswer {
  repo: RepoRef | null;
  pulls: PullRequest[];
  /** Set when the list could not be read. Carries gh's own words where it said anything useful. */
  reason: string | null;
  code: 'OK' | 'NO_REMOTE' | 'NOT_GITHUB' | 'NO_ACCESS' | 'NOT_SIGNED_IN' | 'OFFLINE' | 'FAILED';
}

/**
 * Why a `gh` failure happened, in words that name the fix.
 *
 * **GitHub deliberately conflates "does not exist" with "you cannot see it"** — both return
 * `Could not resolve to a Repository`, so that nobody can enumerate private repositories by watching error
 * codes. The message says both possibilities rather than guessing at one, because guessing produces "this repo
 * does not exist" about a repository the user is looking at in another tab.
 */
function classify(detail: string): { code: PullsAnswer['code']; reason: string } {
  if (/could not resolve to a repository/i.test(detail)) {
    return {
      code: 'NO_ACCESS',
      reason:
        'GitHub will not say whether this repository exists or whether the signed-in account cannot see it — it answers the same way for both. If it is private, sign in with an account that has access.'
    };
  }
  if (/gh auth login|not logged in|bad credentials|http 401/i.test(detail)) {
    return { code: 'NOT_SIGNED_IN', reason: 'The GitHub CLI is not signed in to an account that can read this.' };
  }
  if (/dial tcp|no such host|network is unreachable|i\/o timeout|connection refused|timed out/i.test(detail)) {
    return { code: 'OFFLINE', reason: 'Could not reach GitHub.' };
  }
  return { code: 'FAILED', reason: detail };
}

/**
 * Open pull requests for a project's repository.
 *
 * Read-only, and the only GitHub call this feature makes. Failures are classified rather than thrown: a
 * repository the account cannot see is a state the page should explain, not an error page.
 */
export async function listPulls(project: Project): Promise<PullsAnswer> {
  const repo = await repoFor(project);
  if (!repo) {
    return {
      repo: null,
      pulls: [],
      code: 'NO_REMOTE',
      reason: 'This project has no `origin` remote, so it has no pull requests. Reviewing its branch still works.'
    };
  }
  if (!repo.isGitHub) {
    return {
      repo,
      pulls: [],
      code: 'NOT_GITHUB',
      // Said plainly rather than silently showing an empty list, which would read as "no open pull requests".
      reason: `${repo.host} is not GitHub, so the GitHub CLI cannot list its pull requests. Reviewing this project's branch still works.`
    };
  }

  const result = await probe(
    'gh',
    [
      'pr',
      'list',
      '-R',
      `${repo.owner}/${repo.repo}`,
      '--state',
      'open',
      '--limit',
      String(LIST_LIMIT),
      '--json',
      FIELDS
    ],
    LIST_TIMEOUT_MS
  );

  if (!result.ok) {
    const { code, reason } = classify(result.detail ?? '');
    return { repo, pulls: [], code, reason };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { repo, pulls: [], code: 'FAILED', reason: 'The GitHub CLI returned something that was not JSON.' };
  }
  if (!Array.isArray(parsed)) return { repo, pulls: [], code: 'FAILED', reason: 'Unexpected reply from the GitHub CLI.' };

  const pulls: PullRequest[] = parsed.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const author = (item.author ?? {}) as Record<string, unknown>;
    return {
      number: typeof item.number === 'number' ? item.number : 0,
      title: String(item.title ?? ''),
      author: String(author.login ?? 'unknown'),
      head: String(item.headRefName ?? ''),
      base: String(item.baseRefName ?? ''),
      isDraft: item.isDraft === true,
      // An empty string means nobody has reviewed it yet; null reads better than '' downstream.
      reviewDecision: item.reviewDecision ? String(item.reviewDecision) : null,
      additions: Number(item.additions ?? 0),
      deletions: Number(item.deletions ?? 0),
      changedFiles: Number(item.changedFiles ?? 0),
      updatedAt: String(item.updatedAt ?? ''),
      url: String(item.url ?? '')
    };
  });

  return { repo, pulls, code: 'OK', reason: null };
}
/**
 * How many repositories are asked about at once.
 *
 * Each is a network round trip to GitHub rather than a local spawn, so this is about being a reasonable client
 * rather than about CPU. Four keeps twenty projects inside a couple of seconds without opening twenty
 * connections at once.
 */
const CONCURRENCY = 4;

export interface ProjectPulls extends PullsAnswer {
  projectId: string;
  projectName: string;
}

/** Run `work` over `items`, at most `limit` at a time, keeping input order. */
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

/**
 * Every project's open pull requests, in one answer.
 *
 * WHY ACROSS ALL PROJECTS. "Which of my repositories have pull requests waiting?" is the same question the deck
 * answers for uncommitted work, and it is the one an editor cannot answer at all — a window knows about one
 * repository. Scoping this page to the selected project meant four repositories' worth of review work was
 * invisible unless you clicked through them one at a time, which is how it was reported.
 *
 * One project failing costs that project its rows and nothing more: a repository the account cannot see must
 * not blank the other four.
 */
export async function listAllPulls(projects: Project[]): Promise<ProjectPulls[]> {
  return pooled(projects, CONCURRENCY, async (project) => {
    const answer = await listPulls(project).catch(
      (err): PullsAnswer => ({
        repo: null,
        pulls: [],
        code: 'FAILED',
        reason: err instanceof Error ? err.message : String(err)
      })
    );
    return { ...answer, projectId: project.id, projectName: project.name };
  });
}
/** One pull request in full, with the diff already rendered by the same viewer the Changes panel uses. */
export interface PullDetail {
  pull: PullRequest;
  /** The unified diff, verbatim from `gh pr diff`. Parsed on the client by `parseDiff`. */
  diff: string;
  /** Paths it touches, from GitHub rather than from the diff — a binary file has no hunks to count. */
  files: string[];
  body: string;
  reason: string | null;
}

/**
 * Everything about one pull request.
 *
 * Two calls: `view` for the facts and `diff` for the patch. The diff comes back as text and goes straight into
 * the existing diff viewer — word-level highlighting and all — which is most of this feature arriving for free.
 */
export async function pullDetail(project: Project, number: number): Promise<PullDetail | { reason: string }> {
  const repo = await repoFor(project);
  if (!repo?.isGitHub) return { reason: 'This project does not point at a GitHub repository.' };
  const target = `${repo.owner}/${repo.repo}`;

  const [view, diff] = await Promise.all([
    probe('gh', ['pr', 'view', String(number), '-R', target, '--json', `${FIELDS},body,files`], LIST_TIMEOUT_MS),
    probe('gh', ['pr', 'diff', String(number), '-R', target], LIST_TIMEOUT_MS)
  ]);

  if (!view.ok) return { reason: classify(view.detail ?? '').reason };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(view.stdout) as Record<string, unknown>;
  } catch {
    return { reason: 'The GitHub CLI returned something that was not JSON.' };
  }

  const author = (parsed.author ?? {}) as Record<string, unknown>;
  const files = Array.isArray(parsed.files)
    ? parsed.files.map((file) => String((file as Record<string, unknown>).path ?? '')).filter(Boolean)
    : [];

  return {
    pull: {
      number: Number(parsed.number ?? number),
      title: String(parsed.title ?? ''),
      author: String(author.login ?? 'unknown'),
      head: String(parsed.headRefName ?? ''),
      base: String(parsed.baseRefName ?? ''),
      isDraft: parsed.isDraft === true,
      reviewDecision: parsed.reviewDecision ? String(parsed.reviewDecision) : null,
      additions: Number(parsed.additions ?? 0),
      deletions: Number(parsed.deletions ?? 0),
      changedFiles: Number(parsed.changedFiles ?? files.length),
      updatedAt: String(parsed.updatedAt ?? ''),
      url: String(parsed.url ?? '')
    },
    diff: diff.ok ? diff.stdout : '',
    files,
    body: String(parsed.body ?? ''),
    // A diff that failed while the facts arrived is worth saying: a 5000-file pull request times out here.
    reason: diff.ok ? null : (diff.detail ?? 'Could not read the diff.')
  };
}

/**
 * Bring a pull request's commit into the local repository without touching anything.
 *
 * `git fetch origin pull/N/head:refs/flightdeck/pr-N` — a ref in a namespace this tool owns. **No checkout, no
 * branch switch, no working-tree change**, which is the rule this whole project is built on: the human decides
 * what the tree contains. The ref exists so the reviewer can read whole files at the pull request's own commit
 * rather than guessing from a patch.
 *
 * Verified on a real pull request before it was built into anything: the ref appeared, `git diff` against the
 * merge base matched GitHub's own +183/−15, and `git status` was unchanged on the branch that was checked out.
 *
 * Forced, so the same ref is reused as a pull request gains commits rather than accumulating one ref per fetch.
 */
export async function fetchPullRef(
  project: Project,
  number: number,
  baseRef: string
): Promise<{ ref: string; sha: string; mergeBase: string } | { reason: string }> {
  const ref = `refs/flightdeck/pr-${number}`;
  const fetched = await runGit(
    project.path,
    ['fetch', 'origin', '--force', `pull/${number}/head:${ref}`],
    FETCH_TIMEOUT_MS
  );
  if (!fetched.ok) {
    return { reason: fetched.stderr.trim() || `Could not fetch pull request ${number}.` };
  }

  const sha = await runGit(project.path, ['rev-parse', ref], 5000);
  const mergeBase = await runGit(project.path, ['merge-base', baseRef, ref], 5000);
  if (!sha.ok || !mergeBase.ok) {
    return { reason: `Fetched ${ref}, but could not measure it against ${baseRef}.` };
  }
  return { ref, sha: sha.stdout.trim(), mergeBase: mergeBase.stdout.trim() };
}
