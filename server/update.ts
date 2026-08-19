/**
 * Whether this copy of Flight Deck is behind its own remote.
 *
 * ASKED OF GIT, NOT OF AN API. The obvious alternative is the GitHub API, and it is wrong here for three
 * reasons: it needs a hardcoded repository, which makes a fork check the wrong one; it is a third-party
 * request from an app that claims to make none of its own; and it has rate limits and an auth story. The
 * install is already a git clone with a remote — asking it is cheaper, works offline for the comparison,
 * and a fork compares against the fork, which is where its owner actually pushes.
 *
 * Every command here runs against `appRoot()` and is read-only except `applyUpdate`, which fast-forwards
 * and refuses anything else.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateCommit, UpdateStatus } from '@shared/types';
import { messageOf, runGit } from './git-exec.js';
import { appRoot } from './platform.js';

/** Enough to see what is coming without turning the settings page into a changelog. */
const MAX_INCOMING = 20;

/** Field separator for `git log --format`, built from its code point so the source stays readable. */
const UNIT = String.fromCharCode(31);

const EMPTY: UpdateStatus = {
  state: 'not-a-repo',
  branch: null,
  upstream: null,
  incoming: [],
  behind: 0,
  ahead: 0,
  installed: null,
  lastFetchedAt: null,
  dirty: false,
  detail: null
};

function parseCommits(stdout: string): UpdateCommit[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, at, author] = line.split(UNIT);
      return {
        sha: (sha ?? '').trim(),
        subject: (subject ?? '').trim(),
        at: (at ?? '').trim(),
        author: (author ?? '').trim()
      };
    })
    .filter((commit) => commit.sha.length > 0);
}

/**
 * When the remote was last contacted.
 *
 * `.git/FETCH_HEAD` is rewritten by every fetch, so its mtime is the honest answer — and it means the
 * answer survives a restart, which a variable in memory would not.
 */
function lastFetchedAt(root: string): string | null {
  try {
    return new Date(statSync(join(root, '.git', 'FETCH_HEAD')).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

/**
 * Read the install's position without contacting the remote.
 *
 * Cheap enough to call on every page load: four local git commands, no network.
 */
export async function readUpdateStatus(root = appRoot()): Promise<UpdateStatus> {
  if (!existsSync(join(root, '.git'))) {
    return {
      ...EMPTY,
      detail: 'This copy is not a git clone, so there is nothing to compare against.'
    };
  }

  const branchResult = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branchResult.ok) {
    return { ...EMPTY, state: 'error', detail: messageOf(branchResult) };
  }
  const branch = branchResult.stdout.trim();

  const format = ['%h', '%s', '%cI', '%an'].join('%x1f');
  const [headResult, upstreamResult, statusResult] = await Promise.all([
    runGit(root, ['log', '-1', `--format=${format}`]),
    // Fails when the branch tracks nothing, which is a normal state and not an error.
    runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    runGit(root, ['status', '--porcelain'])
  ]);

  const installed = headResult.ok ? (parseCommits(headResult.stdout)[0] ?? null) : null;
  const dirty = statusResult.ok && statusResult.stdout.trim().length > 0;
  const fetchedAt = lastFetchedAt(root);

  if (!upstreamResult.ok) {
    return {
      ...EMPTY,
      state: 'no-upstream',
      branch: branch || null,
      installed,
      dirty,
      lastFetchedAt: fetchedAt,
      detail: `${branch || 'This branch'} tracks nothing, so there is no remote to compare with.`
    };
  }
  const upstream = upstreamResult.stdout.trim();

  const [counts, incomingResult] = await Promise.all([
    // `behind<TAB>ahead` relative to the upstream ref.
    runGit(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]),
    runGit(root, ['log', `HEAD..${upstream}`, `--format=${format}`, `--max-count=${MAX_INCOMING}`])
  ]);

  let behind = 0;
  let ahead = 0;
  if (counts.ok) {
    const [left, right] = counts.stdout.trim().split(/\s+/);
    behind = Number(left) || 0;
    ahead = Number(right) || 0;
  }

  const state: UpdateStatus['state'] =
    behind > 0 && ahead > 0 ? 'diverged' : behind > 0 ? 'behind' : ahead > 0 ? 'ahead' : 'up-to-date';

  return {
    state,
    branch: branch || null,
    upstream,
    incoming: incomingResult.ok ? parseCommits(incomingResult.stdout) : [],
    behind,
    ahead,
    installed,
    lastFetchedAt: fetchedAt,
    dirty,
    detail: counts.ok ? null : messageOf(counts)
  };
}

/** Contact the remote, then re-read. The only outbound request Flight Deck makes on its own behalf. */
export async function fetchAndRead(root = appRoot()): Promise<UpdateStatus> {
  if (!existsSync(join(root, '.git'))) return readUpdateStatus(root);

  const result = await runGit(root, ['fetch', '--quiet'], 30_000);
  const status = await readUpdateStatus(root);
  // A failed fetch still leaves a usable local answer, so it is reported alongside rather than thrown.
  if (!result.ok) return { ...status, detail: messageOf(result) || status.detail };
  return status;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  detail?: string;
  status: UpdateStatus;
}

/**
 * Fast-forward the install to its remote.
 *
 * `--ff-only`, so a fork with its own commits is refused rather than merged — and a dirty tree is refused
 * before git is asked, because someone editing Flight Deck itself is the likeliest person to press this.
 * Nothing here rebases, resets or stashes on the user's behalf.
 *
 * Dependencies are NOT installed and the server is NOT restarted: both would kill the process running this
 * request, and both are the user's decision. The message says what to do instead.
 */
export async function applyUpdate(root = appRoot()): Promise<ApplyResult> {
  const before = await readUpdateStatus(root);

  if (before.state === 'not-a-repo') {
    return { ok: false, message: 'This copy is not a git clone, so there is nothing to update.', status: before };
  }
  if (before.state === 'no-upstream') {
    return { ok: false, message: before.detail ?? 'This branch tracks no remote.', status: before };
  }
  if (before.dirty) {
    return {
      ok: false,
      message: 'Flight Deck has uncommitted changes of its own.',
      detail: 'Commit or stash them first — updating would have to touch files you are editing.',
      status: before
    };
  }
  if (before.state === 'diverged') {
    return {
      ok: false,
      message: `This branch has ${before.ahead} commit${before.ahead === 1 ? '' : 's'} the remote does not.`,
      detail: 'A fast-forward is impossible. Push or rebase your work, then update.',
      status: before
    };
  }
  if (before.state !== 'behind') {
    return { ok: false, message: 'Already up to date.', status: before };
  }

  const pull = await runGit(root, ['merge', '--ff-only', before.upstream ?? '@{u}'], 60_000);
  const after = await readUpdateStatus(root);
  if (!pull.ok) {
    return { ok: false, message: 'Could not fast-forward.', detail: messageOf(pull), status: after };
  }

  return {
    ok: true,
    message: `Updated to ${after.installed?.sha ?? 'the latest commit'}.`,
    detail: 'Restart the server to load it. Run npm install first if dependencies changed.',
    status: after
  };
}
