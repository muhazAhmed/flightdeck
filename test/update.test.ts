import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyUpdate, readUpdateStatus } from '../server/update.ts';

/**
 * Update detection, against real git repositories.
 *
 * Mocked git would prove nothing here: every interesting case (behind, diverged, dirty, no upstream) is a
 * fact about a repository, and the whole point of asking git instead of a web API is that git is the source
 * of truth. So each test builds an actual bare remote and clone in a temp directory.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }
  });
}

interface Fixture {
  root: string;
  remote: string;
  clone: string;
  other: string;
}

/** A bare remote, a clone (the "install"), and a second clone to push from. */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-update-'));
  const remote = join(root, 'remote.git');
  const clone = join(root, 'install');
  const other = join(root, 'other');

  git(root, ['init', '--bare', '--initial-branch=main', remote]);
  git(root, ['clone', '--quiet', remote, 'install']);
  for (const dir of [clone]) {
    git(dir, ['config', 'user.email', 'a@example.com']);
    git(dir, ['config', 'user.name', 'A']);
  }
  writeFileSync(join(clone, 'file.txt'), 'one\n');
  git(clone, ['add', '-A']);
  git(clone, ['commit', '-qm', 'first commit']);
  git(clone, ['push', '-q', '-u', 'origin', 'main']);

  git(root, ['clone', '--quiet', remote, 'other']);
  git(other, ['config', 'user.email', 'b@example.com']);
  git(other, ['config', 'user.name', 'B']);

  return { root, remote, clone, other };
}

/** Push a commit from the second clone, then let the install see it. */
function pushUpstreamCommit(fixture: Fixture, subject: string): void {
  writeFileSync(join(fixture.other, `${subject.replace(/\W+/g, '-')}.txt`), 'x\n');
  git(fixture.other, ['add', '-A']);
  git(fixture.other, ['commit', '-qm', subject]);
  git(fixture.other, ['push', '-q', 'origin', 'main']);
  git(fixture.clone, ['fetch', '--quiet']);
}

async function withFixture(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = makeFixture();
  try {
    await body(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('a clone level with its remote is up to date', async () => {
  await withFixture(async ({ clone }) => {
    const status = await readUpdateStatus(clone);
    assert.equal(status.state, 'up-to-date');
    assert.equal(status.branch, 'main');
    assert.equal(status.upstream, 'origin/main');
    assert.equal(status.behind, 0);
    assert.equal(status.installed?.subject, 'first commit');
    assert.equal(status.dirty, false);
  });
});

test('a pushed commit is reported as behind, with its subject', async () => {
  await withFixture(async (fixture) => {
    pushUpstreamCommit(fixture, 'Add the thing');
    const status = await readUpdateStatus(fixture.clone);
    assert.equal(status.state, 'behind');
    assert.equal(status.behind, 1);
    assert.equal(status.ahead, 0);
    // What is coming, not just how much — a bare count tells the user nothing about whether to bother.
    assert.equal(status.incoming.length, 1);
    assert.equal(status.incoming[0]?.subject, 'Add the thing');
    assert.equal(status.incoming[0]?.author, 'B');
    assert.ok((status.incoming[0]?.sha.length ?? 0) >= 7);
  });
});

test('incoming commits are newest first', async () => {
  await withFixture(async (fixture) => {
    pushUpstreamCommit(fixture, 'older');
    pushUpstreamCommit(fixture, 'newer');
    const status = await readUpdateStatus(fixture.clone);
    assert.deepEqual(status.incoming.map((c) => c.subject), ['newer', 'older']);
  });
});

test('local commits make it ahead, not behind', async () => {
  await withFixture(async ({ clone }) => {
    writeFileSync(join(clone, 'mine.txt'), 'mine\n');
    git(clone, ['add', '-A']);
    git(clone, ['commit', '-qm', 'my own work']);
    const status = await readUpdateStatus(clone);
    assert.equal(status.state, 'ahead');
    assert.equal(status.ahead, 1);
    assert.equal(status.behind, 0);
  });
});

test('a fork with its own commits and new upstream commits is diverged', async () => {
  await withFixture(async (fixture) => {
    writeFileSync(join(fixture.clone, 'mine.txt'), 'mine\n');
    git(fixture.clone, ['add', '-A']);
    git(fixture.clone, ['commit', '-qm', 'my own work']);
    pushUpstreamCommit(fixture, 'theirs');

    const status = await readUpdateStatus(fixture.clone);
    assert.equal(status.state, 'diverged');
    assert.equal(status.behind, 1);
    assert.equal(status.ahead, 1);
  });
});

test('a branch tracking nothing says so instead of erroring', async () => {
  await withFixture(async ({ clone }) => {
    git(clone, ['checkout', '-q', '-b', 'local-only']);
    const status = await readUpdateStatus(clone);
    assert.equal(status.state, 'no-upstream');
    assert.equal(status.branch, 'local-only');
    assert.match(status.detail ?? '', /tracks nothing/);
  });
});

test('a directory that is not a repository is a state, not a failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-not-a-repo-'));
  try {
    const status = await readUpdateStatus(dir);
    assert.equal(status.state, 'not-a-repo');
    assert.match(status.detail ?? '', /not a git clone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uncommitted work is reported as dirty', async () => {
  await withFixture(async ({ clone }) => {
    writeFileSync(join(clone, 'file.txt'), 'edited\n');
    assert.equal((await readUpdateStatus(clone)).dirty, true);
  });
});

test('applying an update fast-forwards and reports the new commit', async () => {
  await withFixture(async (fixture) => {
    pushUpstreamCommit(fixture, 'Add the thing');
    const result = await applyUpdate(fixture.clone);
    assert.equal(result.ok, true);
    assert.equal(result.status.state, 'up-to-date');
    assert.equal(result.status.installed?.subject, 'Add the thing');
    // Dependencies and restarts are the user's call — the message has to say so.
    assert.match(result.detail ?? '', /Restart the server/);
    assert.match(result.detail ?? '', /npm install/);
  });
});

test('a dirty tree refuses the update, and changes nothing', async () => {
  await withFixture(async (fixture) => {
    pushUpstreamCommit(fixture, 'Add the thing');
    writeFileSync(join(fixture.clone, 'file.txt'), 'my edit\n');

    const result = await applyUpdate(fixture.clone);
    assert.equal(result.ok, false);
    assert.match(result.message, /uncommitted changes/);
    // The person most likely to press this button is someone editing Flight Deck itself.
    assert.equal(result.status.state, 'behind');
    assert.equal(git(fixture.clone, ['show', '-s', '--format=%s']).trim(), 'first commit');
  });
});

test('a diverged fork is refused rather than merged', async () => {
  await withFixture(async (fixture) => {
    writeFileSync(join(fixture.clone, 'mine.txt'), 'mine\n');
    git(fixture.clone, ['add', '-A']);
    git(fixture.clone, ['commit', '-qm', 'my own work']);
    pushUpstreamCommit(fixture, 'theirs');

    const result = await applyUpdate(fixture.clone);
    assert.equal(result.ok, false);
    // A merge commit nobody asked for, in the user's own fork, would be much worse than a refusal.
    assert.match(result.detail ?? '', /fast-forward is impossible/);
    assert.equal(git(fixture.clone, ['show', '-s', '--format=%s']).trim(), 'my own work');
  });
});

test('applying when already current is a refusal, not a no-op success', async () => {
  await withFixture(async ({ clone }) => {
    const result = await applyUpdate(clone);
    assert.equal(result.ok, false);
    assert.match(result.message, /Already up to date/);
  });
});

test('the update path never resets, rebases or stashes', () => {
  const source = readFileSync('server/update.ts', 'utf8');
  for (const flag of ['reset', 'rebase', 'stash', '--force']) {
    assert.ok(!source.includes(`'${flag}'`), `${flag} must not appear in the update path`);
  }
  assert.match(source, /'--ff-only'/);
});
