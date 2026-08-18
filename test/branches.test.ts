import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchList } from '../server/routes/branches.ts';

/**
 * `git branch --all --format=` output, tab-separated:
 *   %(HEAD) %(refname) %(refname:short) %(upstream:short) %(contents:subject) %(committerdate:relative)
 *
 * Pinned for two reasons. The marker column is a single `*` for the current branch and empty
 * otherwise, so a naive whitespace split shifts every later field. And local must be told
 * apart from remote by the FULL refname — the short form renders a remote branch as
 * `origin/main`, indistinguishable from a local branch whose name contains a slash.
 */
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);

const local = (head: string, name: string, upstream = '', subject = '', when = '') =>
  [head, `refs/heads/${name}`, name, upstream, subject, when].join(TAB);

const remoteRef = (name: string) => ['', `refs/remotes/${name}`, name, '', '', ''].join(TAB);

test('the current branch is identified by the HEAD marker, not by position', () => {
  const list = parseBranchList(
    [
      local('', 'dev', 'origin/dev', 'add thing', '2 days ago'),
      local('*', 'main', 'origin/main', 'fix thing', '1 hour ago')
    ].join(NL)
  );

  assert.equal(list.current, 'main');
  assert.equal(list.local.find((b) => b.name === 'main')?.current, true);
  assert.equal(list.local.find((b) => b.name === 'dev')?.current, false);
});

test('remote refs are separated from local ones and keep their short name', () => {
  const list = parseBranchList(
    [local('*', 'main', 'origin/main'), remoteRef('origin/main'), remoteRef('origin/feature-x')].join(NL)
  );

  assert.deepEqual(
    list.local.map((b) => b.name),
    ['main']
  );
  assert.deepEqual(list.remote, ['origin/main', 'origin/feature-x']);
});

test('origin/HEAD is dropped — it is a pointer, not a branch to check out', () => {
  assert.deepEqual(parseBranchList(remoteRef('origin/HEAD')).remote, []);
});

test('a remote branch is never listed as local, even though its short name has a slash', () => {
  // The bug this pins: with only the short refname, `origin/main` landed in `local` and was
  // offered as a direct checkout.
  const list = parseBranchList([local('*', 'main', 'origin/main'), remoteRef('origin/main')].join(NL));
  assert.deepEqual(
    list.local.map((b) => b.name),
    ['main']
  );
  assert.deepEqual(list.remote, ['origin/main']);
});

test('a branch whose own name contains a slash is still local', () => {
  const list = parseBranchList(local('*', 'feat/article-schema', '', 'wip').concat(NL, remoteRef('origin/main')));
  assert.deepEqual(
    list.local.map((b) => b.name),
    ['feat/article-schema']
  );
});

test('a local-only branch reports no upstream', () => {
  const list = parseBranchList(local('*', 'scratch', '', 'wip'));
  assert.equal(list.local[0]?.upstream, null);
});

test('the commit subject and relative date are preserved, spaces and all', () => {
  const list = parseBranchList(local('*', 'main', 'origin/main', 'fix: handle spaces in paths', '3 minutes ago'));
  assert.equal(list.local[0]?.subject, 'fix: handle spaces in paths');
  assert.equal(list.local[0]?.when, '3 minutes ago');
});

test('empty output is a repository with no branches, not a crash', () => {
  const list = parseBranchList('');
  assert.equal(list.current, null);
  assert.deepEqual(list.local, []);
  assert.deepEqual(list.remote, []);
});
