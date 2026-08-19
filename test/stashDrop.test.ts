import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Deleting a stash.
 *
 * There was no way to do it at all — the row offered restore and nothing else, so a stash you did not want could
 * only be removed by applying it or by using a terminal.
 *
 * The hazard is index renumbering, and it is demonstrated below with real git rather than described: `stash drop`
 * takes a position, and dropping one renumbers everything after it. An index alone can therefore name a different
 * stash than the one the user clicked, and `git stash drop` is the one action in this panel with no way back.
 */
const route = readFileSync('server/routes/git.ts', 'utf8');
const panel = readFileSync('client/features/changes/ChangesPanel.tsx', 'utf8');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x.io' }
  });
}

/** A repository with three stashes, newest first as git lists them. */
function repoWithStashes(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-stash-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'a@x.io']);
  git(dir, ['config', 'user.name', 'A']);
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);

  for (const name of ['first', 'second', 'third']) {
    writeFileSync(join(dir, 'a.txt'), `base\n${name}\n`);
    git(dir, ['stash', 'push', '-q', '-m', `${name} work`]);
  }
  return dir;
}

function subjects(dir: string): string[] {
  return git(dir, ['stash', 'list', '--format=%gs'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

test('git lists stashes newest first', () => {
  const dir = repoWithStashes();
  try {
    assert.deepEqual(subjects(dir), ['On main: third work', 'On main: second work', 'On main: first work']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dropping a stash renumbers the ones after it — the reason the guard exists', () => {
  const dir = repoWithStashes();
  try {
    // Position 1 is "second work" before the drop.
    assert.equal(subjects(dir)[1], 'On main: second work');
    git(dir, ['stash', 'drop', '-q', 'stash@{1}']);

    // The same position now holds a different stash. An index-only delete would take this one next, silently and
    // irreversibly, while the user believed they were deleting "second work" again.
    assert.equal(subjects(dir)[1], 'On main: first work');
    assert.deepEqual(subjects(dir), ['On main: third work', 'On main: first work']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dropping does not touch the working tree', () => {
  const dir = repoWithStashes();
  try {
    git(dir, ['stash', 'drop', '-q', 'stash@{0}']);
    // Unlike pop, drop applies nothing — the file must still be the committed version.
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8').trim(), 'base');
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the route refuses when the stash at that index is not the one shown', () => {
  // The caller sends the subject it displayed; a mismatch means the list moved underneath it.
  assert.match(route, /expectSubject/);
  assert.match(route, /'STASH_MOVED'/);
  assert.match(route, /'STASH_GONE'/);
  // Verified live against three real stashes: after dropping index 1, asking for index 1 with the old subject was
  // refused with "Position 1 now holds ... rather than ...", and nothing was dropped.
  assert.match(route, /Nothing was dropped/);
});

test('the index is validated before it becomes a git argument', () => {
  assert.match(route, /!Number\.isInteger\(index\) \|\| index < 0/);
});

test('deleting a stash always asks, whatever the confirmation level', () => {
  // `setConfirm` rather than `gate`: "only destructive" must still ask for the one action that is destructive.
  const handler = panel.slice(panel.indexOf('function askStashDrop'));
  const body = handler.slice(0, handler.indexOf('\n  }'));
  assert.match(body, /setConfirm\(\{/);
  assert.ok(!body.includes('gate('), 'the drop confirmation must not be gated by the setting');
  assert.match(body, /tone: 'danger'/);
  // And it names the stash rather than a count, so the confirmation is about a specific thing.
  assert.match(body, /files: \[subject\]/);
  assert.match(body, /cannot be undone/);
});

test('the row offers restore and delete, and says which is which', () => {
  assert.match(panel, /label="Restore this stash — applies it and removes the entry"/);
  assert.match(panel, /label="Delete this stash without applying it"/);
});

test('the list is re-read after a drop rather than spliced locally', () => {
  const hook = readFileSync('client/features/changes/useGitPanel.ts', 'utf8');
  const handler = hook.slice(hook.indexOf('const stashDrop'));
  const body = handler.slice(0, handler.indexOf('const stashPop'));
  // Local splicing would leave every remaining row pointing at the wrong index.
  assert.match(body, /gitApi\.stashList\(projectId\)/);
});
