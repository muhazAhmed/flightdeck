import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus } from '../server/routes/status.ts';

/**
 * `--porcelain=v2` is the format git promises not to break, but it is also fiddly: two
 * status characters, fixed-width fields, and paths that may contain spaces or a tab-separated
 * rename. Worth pinning, because a mis-parse here shows the user the wrong file list.
 */
const BRANCH = ['# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1'];

test('branch, upstream and ahead/behind are read from the header', () => {
  const status = parseStatus(BRANCH.join('\n'));
  assert.equal(status.branch, 'main');
  assert.equal(status.tracking, 'origin/main');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
});

test('a detached head reports no branch rather than the literal string', () => {
  const status = parseStatus('# branch.head (detached)');
  assert.equal(status.branch, null);
});

test('a file staged and modified again appears in both lists', () => {
  const status = parseStatus(
    [...BRANCH, '1 MM N... 100644 100644 100644 aaa bbb src/app.ts'].join('\n')
  );
  assert.deepEqual(status.staged, [{ path: 'src/app.ts', status: 'M' }]);
  assert.deepEqual(status.unstaged, [{ path: 'src/app.ts', status: 'M' }]);
});

test('a staged-only file is not listed as changed', () => {
  const status = parseStatus([...BRANCH, '1 M. N... 100644 100644 100644 aaa bbb lib/x.ts'].join('\n'));
  assert.equal(status.staged.length, 1);
  assert.equal(status.unstaged.length, 0);
});

test('untracked files are their own group', () => {
  const status = parseStatus([...BRANCH, '? notes.md'].join('\n'));
  assert.deepEqual(status.untracked, [{ path: 'notes.md', status: '?' }]);
  assert.equal(status.staged.length, 0);
});

test('paths containing spaces survive parsing', () => {
  const status = parseStatus(
    [...BRANCH, '1 .M N... 100644 100644 100644 aaa bbb src/my component.tsx'].join('\n')
  );
  assert.deepEqual(status.unstaged, [{ path: 'src/my component.tsx', status: 'M' }]);
});

test('a rename reports the new path, not the tab-joined pair', () => {
  const status = parseStatus(
    [...BRANCH, '2 R. N... 100644 100644 100644 aaa bbb R100 lib/new.ts\tlib/old.ts'].join('\n')
  );
  assert.deepEqual(status.staged, [{ path: 'lib/new.ts', status: 'R' }]);
});

test('an unmerged file is surfaced rather than dropped', () => {
  const status = parseStatus(
    [...BRANCH, 'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.ts'].join('\n')
  );
  assert.ok(
    [...status.staged, ...status.unstaged].some((f) => f.path === 'conflicted.ts'),
    'a conflict must appear somewhere the user can see it'
  );
});

test('empty output is a clean repository, not a crash', () => {
  const status = parseStatus('');
  assert.equal(status.branch, null);
  assert.equal(status.staged.length + status.unstaged.length + status.untracked.length, 0);
});
