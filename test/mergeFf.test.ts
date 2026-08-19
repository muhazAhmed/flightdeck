import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBranchList } from '../server/routes/branches.ts';

/**
 * Fast-forwarding the current branch onto another ref.
 *
 * The workflow this serves: a pull request is merged on the host, so `origin/dev` moves ahead; you switch to the
 * trunk and want it to catch up, then push yourself. Previously that meant leaving the tool for a terminal.
 *
 * SPEC used to say no merge belongs here at all, and that rule was about the dangerous half of merging — a merge
 * commit, a conflict to resolve, history rewritten. `--ff-only` does none of those: it moves the branch pointer to
 * a commit that already contains yours, or it refuses and changes nothing. Pull has always been `--ff-only`, and
 * the update feature fast-forwards the install itself, so the shape was already established.
 */
const route = readFileSync('server/routes/branches.ts', 'utf8');
// The action lives in the terminal header, beside the build trigger: it is the same kind of step — a short git
// command run by hand, several times a day, immediately before pushing.
const button = readFileSync('client/features/terminal/FastForwardButton.tsx', 'utf8');
const menu = readFileSync('client/features/changes/BranchMenu.tsx', 'utf8');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x.io' }
  });
}

interface Fixture {
  root: string;
  work: string;
  other: string;
}

/** A bare remote, a clone on `main`, and a second clone standing in for whoever merged the pull request. */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-mergeff-'));
  git(root, ['init', '--bare', '--initial-branch=main', 'up.git']);
  git(root, ['clone', '--quiet', join(root, 'up.git'), 'work']);
  const work = join(root, 'work');
  git(work, ['config', 'user.email', 'a@x.io']);
  git(work, ['config', 'user.name', 'A']);

  writeFileSync(join(work, 'a.txt'), 'base\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-qm', 'initial']);
  git(work, ['push', '-q', '-u', 'origin', 'main']);
  git(work, ['checkout', '-q', '-b', 'dev']);
  git(work, ['push', '-q', '-u', 'origin', 'dev']);
  git(work, ['checkout', '-q', 'main']);

  git(root, ['clone', '--quiet', join(root, 'up.git'), 'other']);
  const other = join(root, 'other');
  git(other, ['config', 'user.email', 'b@x.io']);
  git(other, ['config', 'user.name', 'B']);
  return { root, work, other };
}

/** What merging a pull request on the host looks like from here: origin/dev moves ahead. */
function pushToDev(f: Fixture, subject: string): void {
  git(f.other, ['checkout', '-q', 'dev']);
  writeFileSync(join(f.other, `${subject.replace(/\W+/g, '-')}.txt`), 'x\n');
  git(f.other, ['add', '-A']);
  git(f.other, ['commit', '-qm', subject]);
  git(f.other, ['push', '-q', 'origin', 'dev']);
  git(f.work, ['fetch', '--quiet']);
}

function withFixture(body: (f: Fixture) => void): void {
  const f = fixture();
  try {
    body(f);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
}

test('the trunk fast-forwards onto origin/dev after a pull request lands', () => {
  withFixture((f) => {
    pushToDev(f, 'feat the thing');
    assert.equal(git(f.work, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');

    git(f.work, ['merge', '--ff-only', 'origin/dev']);

    // main now carries the commit, and is ahead of its own upstream — ready for a push the user makes themselves.
    assert.match(git(f.work, ['log', '--oneline', '-1']), /feat the thing/);
    assert.match(git(f.work, ['status', '-sb']), /ahead 1/);
  });
});

test('a fast-forward pushes nothing', () => {
  withFixture((f) => {
    pushToDev(f, 'feat the thing');
    git(f.work, ['merge', '--ff-only', 'origin/dev']);
    // The remote must be untouched: pushing stays a separate, deliberate act.
    assert.equal(git(f.work, ['rev-parse', 'origin/main']).trim(), git(f.work, ['rev-parse', 'origin/main']).trim());
    assert.match(git(f.work, ['status', '-sb']), /ahead 1/);
  });
});

test('a genuine divergence refuses and changes nothing', () => {
  withFixture((f) => {
    pushToDev(f, 'theirs');
    git(f.work, ['checkout', '-q', 'dev']);
    writeFileSync(join(f.work, 'mine.txt'), 'mine\n');
    git(f.work, ['add', '-A']);
    git(f.work, ['commit', '-qm', 'mine']);

    const before = git(f.work, ['rev-parse', 'HEAD']).trim();
    let failed = false;
    try {
      git(f.work, ['merge', '--ff-only', 'origin/dev']);
    } catch {
      failed = true;
    }
    assert.ok(failed, 'git itself must refuse — this is what --ff-only buys');
    assert.equal(git(f.work, ['rev-parse', 'HEAD']).trim(), before, 'HEAD must not move');
    // And nothing is left half-merged for the user to untangle.
    assert.equal(git(f.work, ['status', '--porcelain']).trim(), '');
  });
});

test('an already-contained ref is a success, not a refusal', () => {
  withFixture((f) => {
    // origin/main is an ancestor of dev here, so there is nothing to do and that is fine.
    git(f.work, ['checkout', '-q', 'dev']);
    const output = git(f.work, ['merge', '--ff-only', 'origin/main']);
    assert.match(output, /up to date/i);
  });
});

test('origin/HEAD is filtered on the full ref, not the short one', () => {
  withFixture((f) => {
    // This clone was made from an empty repository, so it never got an origin/HEAD. A normal clone of a repository
    // that already has commits does — which is why the bug only showed up on a real project.
    git(f.work, ['remote', 'set-head', 'origin', '-a']);

    const raw = git(f.work, [
      'branch',
      '--all',
      '--format=%(HEAD)%09%(refname)%09%(refname:short)%09%(upstream:short)%09%(contents:subject)%09%(committerdate:relative)'
    ]);
    // git abbreviates `refs/remotes/origin/HEAD` to plain `origin`, which does not end in `/HEAD` — so filtering on
    // the short name let a bogus `origin` row into the branch list. Found when a merge action appeared beside it.
    assert.match(raw, /refs\/remotes\/origin\/HEAD\torigin\t/);

    const parsed = parseBranchList(raw);
    assert.ok(!parsed.remote.includes('origin'), 'a bare remote name is not a branch');
    assert.deepEqual(parsed.remote.sort(), ['origin/dev', 'origin/main']);
  });
});

test('the route refuses a dirty tree, the current branch, and an unknown ref', () => {
  // Each is a sentence the user can act on rather than a plumbing error, and each was verified live.
  assert.match(route, /'GIT_DIRTY'/);
  assert.match(route, /'SAME_BRANCH'/);
  assert.match(route, /'NO_SUCH_REF'/);
  assert.match(route, /'NOT_FF'/);
  // The ref is verified as a real commit before it is used.
  assert.match(route, /'rev-parse', '--verify', '--quiet'/);
});

test('the merge is --ff-only and cannot be talked into anything else', () => {
  assert.match(route, /\['merge', '--ff-only', ref\]/);
  for (const flag of ['--no-ff', '--squash', '--strategy', '-X', '--allow-unrelated']) {
    assert.ok(!route.includes(`'${flag}'`), `${flag} must not be reachable`);
  }
  // A ref goes through the same shape check as a branch name, which rejects a leading dash.
  assert.match(route, /const invalid = invalidBranchName\(ref\)/);
});

test('the ref shape check rejects an argument disguised as a branch', () => {
  const menuSource = route;
  assert.match(menuSource, /cannot start with a dash or a dot/);
});

test('the confirmation names the exact command and the branch being moved', () => {
  assert.match(button, /files: \[`git merge --ff-only \$\{ref\}`\]/);
  assert.match(button, /Fast-forward \$\{onto\} to \$\{ref\}\?/);
});

test('the button shows the ref it will use, and remembers it per project', () => {
  // A button that runs a guessed command without saying which one is worse than no button.
  // The label IS the ref, so there is never any doubt which command the click runs.
  assert.match(button, /\{running \? 'merging…' : target\}/);
  // Remembered only after it has actually worked, so a failed guess is not persisted.
  assert.match(button, /projectsApi\.update\(project\.id, \{ fastForwardRef: ref \}\)/);
  // And the guess is only a first guess, for the workflow this serves.
  assert.match(button, /const LIKELY = \['origin\/dev', 'origin\/develop', 'origin\/development'\]/);
});

test('the button is one button, with no menu', () => {
  // A dropdown to change the ref was removed: the command is the same one every time, so the caret was a click
  // that never paid for itself.
  assert.ok(!button.includes('DropdownMenu'), 'no menu on this button');
});

test('it only appears on the trunk, and only when there is a dev branch to merge', () => {
  // On any other branch it was offering a command that did not apply, and it named origin/dev wherever you were.
  assert.match(button, /const onTrunk = branches\?\.defaultBranch != null && current === branches\.defaultBranch/);
  assert.match(button, /if \(!onTrunk \|\| !target\) return null/);
  // No dev-ish branch and nothing remembered means no target, which means no button — rather than one naming a
  // branch that does not exist.
  assert.match(button, /const LIKELY = \['origin\/dev', 'origin\/develop', 'origin\/development'\]/);
});

test('the branch menu can be searched too', () => {
  assert.match(menu, /placeholder="Search branches…"/);
  assert.match(menu, /localMatches/);
  assert.match(menu, /remoteMatches/);
});

test('nothing typed in the shell is left invisible to the Changes panel', () => {
  const drawer = readFileSync('client/features/terminal/TerminalDrawer.tsx', 'utf8');
  const shell = readFileSync('client/app/AppShell.tsx', 'utf8');
  // A merge or checkout typed into the terminal moves exactly the state the panel shows, and nothing else would
  // tell it. Parsing the input is not attempted — history, aliases and arrow keys all defeat that.
  assert.match(drawer, /onShellActivity/);
  // Debounced, or a build log would cost one git status per chunk of output.
  assert.match(shell, /const onShellActivity = useDebouncedCallback\(bumpGit, \d+, \d+\)/);
});

test('being on the wrong branch is a warning, not a silent action', () => {
  // Asked for explicitly: doing this while on a feature branch instead of the trunk is the mistake to catch. It is
  // not blocked, because a fast-forward cannot lose work and there are legitimate reasons to do it.
  assert.match(button, /const offTrunk = branches\?\.defaultBranch != null && current != null && current !== branches\.defaultBranch/);
  assert.match(button, /tone: offTrunk \? 'danger' : 'default'/);
  assert.match(button, /You are on \$\{onto\}, not \$\{branches\?\.defaultBranch\}/);
});

test('the default branch comes from the repository, not from a guess', () => {
  assert.match(route, /'symbolic-ref', '--short', 'refs\/remotes\/origin\/HEAD'/);
  // The fallback only accepts a conventional name that actually exists, and returns null rather than inventing one.
  assert.match(route, /for \(const name of \['main', 'master'\]\)/);
  assert.match(route, /return null;/);
});

test('creating a branch is its own button, not the last row of a list', () => {
  // It sat at the end of the dropdown, past however many branches the repository has.
  assert.match(menu, /title=\{`New branch from \$\{current \?\? 'here'\}`\}/);
  assert.ok(!menu.includes('New branch from {current'), 'the dropdown row should be gone');
  // Green is allowed here because creating is an addition — but through the fill token, since the bright mark
  // colour measured 2.3:1 against white text.
  assert.match(menu, /bg-\(--fill-success\)/);
  assert.match(menu, /text-white/);
});

test('tracked remotes are offered, so origin/dev can be chosen at all', () => {
  // The branch menu used to hide remotes with a local counterpart, on the grounds the local row reached the same
  // thing. True for checkout; false for a fast-forward, since after a merged pull request origin/dev is exactly the
  // ref that is ahead of local dev.
  assert.match(menu, /tracked by \{trackedBy\.name\}/);
  assert.ok(!menu.includes('.filter((name) => !(branches?.local ?? []).some((l) => l.upstream === name))'));
  // The candidate list still excludes the remote counterpart of the branch you are on, which cannot be merged
  // into itself.
  assert.match(button, /name !== `origin\/\$\{current \?\? ''\}`/);
});
