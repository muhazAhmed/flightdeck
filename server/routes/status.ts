/**
 * Reading status without simple-git, so remote operations and identity routes can share one
 * definition of "what state is this repo in".
 *
 * `--porcelain=v2 --branch` is the machine-readable format git promises not to change. It is
 * more verbose than v1 but it carries the branch, the upstream, and the ahead/behind counts
 * in the same call — which is exactly what the panel needs and what v1 makes you guess at.
 */
import type { GitFile, GitStatus } from '@shared/types';
import { runGit } from '../git-exec.js';

const EMPTY: GitStatus = {
  branch: null,
  tracking: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: []
};

/**
 * Parse `git status --porcelain=v2 --branch`.
 *
 * Relevant line shapes:
 *   # branch.head main
 *   # branch.upstream origin/main
 *   # branch.ab +2 -1
 *   1 MD N... <mode> <mode> <mode> <hash> <hash> path      (ordinary change)
 *   2 R. N... <…> <hash> <hash> R100 new<TAB>old           (rename/copy)
 *   u UU N... <…> path                                     (unmerged)
 *   ? path                                                 (untracked)
 *
 * The two status characters are index-then-worktree, so a file can appear in both the
 * staged and the changed list — which is correct, and what a source-control panel must show.
 */
export function parseStatus(stdout: string): GitStatus {
  const result: GitStatus = { ...EMPTY, staged: [], unstaged: [], untracked: [] };

  for (const line of stdout.split('\n')) {
    if (!line) continue;

    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      // git reports a detached head as the literal "(detached)".
      result.branch = head === '(detached)' ? null : head;
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      result.tracking = line.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice('# branch.ab '.length).trim().split(' ');
      result.ahead = Math.abs(Number(ahead ?? 0)) || 0;
      result.behind = Math.abs(Number(behind ?? 0)) || 0;
      continue;
    }
    if (line.startsWith('#')) continue;

    if (line.startsWith('? ')) {
      result.untracked.push({ path: line.slice(2), status: '?' });
      continue;
    }

    const kind = line[0];
    if (kind !== '1' && kind !== '2' && kind !== 'u') continue;

    const fields = line.split(' ');
    const xy = fields[1] ?? '..';
    const index = xy[0] ?? '.';
    const worktree = xy[1] ?? '.';

    // Paths can contain spaces, so take everything after the fixed-width fields and stop at
    // a tab. Field counts differ per line kind:
    //   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>                        -> 8
    //   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <new>TAB<old>        -> 9
    //   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>              -> 10
    const fixedFields = kind === 'u' ? 10 : kind === '2' ? 9 : 8;
    const path = fields.slice(fixedFields).join(' ').split('\t')[0] ?? '';
    if (!path) continue;

    const entry: GitFile = { path, status: index !== '.' ? index : worktree };
    if (index !== '.') result.staged.push({ path, status: index });
    if (worktree !== '.') result.unstaged.push({ path, status: worktree });
    if (index === '.' && worktree === '.') result.unstaged.push(entry);
  }

  return result;
}

/** Current status, or null when git itself failed (not a repo, missing binary). */
export async function readStatus(cwd: string): Promise<GitStatus | null> {
  const result = await runGit(cwd, ['status', '--porcelain=v2', '--branch']);
  if (!result.ok) return null;
  return parseStatus(result.stdout);
}
