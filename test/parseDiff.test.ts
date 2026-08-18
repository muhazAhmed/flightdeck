import test from 'node:test';
import assert from 'node:assert/strict';
import { countLines, diffStats, parseDiff } from '../client/features/changes/parseDiff.ts';

const SAMPLE = `diff --git a/src/greet.ts b/src/greet.ts
index 83db48f..bf3a5d1 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,4 +1,5 @@
 export function greet(name: string) {
-  console.log('Hello, ' + name);
+  const greeting = \`Hello, \${name}\`;
+  console.log(greeting);
 }
 
@@ -10,2 +11,2 @@ export function farewell() {
-  return 'bye';
+  return 'goodbye';
`;

test('hunk headers set the starting line numbers for both sides', () => {
  const [first] = parseDiff(SAMPLE);
  assert.ok(first);
  const [context] = first.lines;
  assert.equal(context?.kind, 'context');
  assert.equal(context?.oldNumber, 1);
  assert.equal(context?.newNumber, 1);
});

test('additions have no old number and deletions have no new number', () => {
  const lines = parseDiff(SAMPLE).flatMap((hunk) => hunk.lines);
  for (const line of lines) {
    if (line.kind === 'add') assert.equal(line.oldNumber, null);
    if (line.kind === 'del') assert.equal(line.newNumber, null);
  }
});

test('line numbers advance independently on each side', () => {
  const [first] = parseDiff(SAMPLE);
  assert.ok(first);
  // context(1,1) · del(2,-) · add(-,2) · add(-,3) · context(3,4) · context(4,5)
  assert.deepEqual(
    first.lines.map((line) => [line.kind, line.oldNumber, line.newNumber]),
    [
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4],
      ['context', 4, 5]
    ]
  );
});

test('a blank context line is kept, because dropping it would shift every number after it', () => {
  const [first] = parseDiff(SAMPLE);
  const trailing = first?.lines.at(-1);
  assert.equal(trailing?.kind, 'context');
  assert.equal(trailing?.text, '');
});

test('the file preamble is dropped, not rendered as content', () => {
  const text = parseDiff(SAMPLE)
    .flatMap((hunk) => hunk.lines)
    .map((line) => line.text)
    .join('\n');
  assert.ok(!text.includes('diff --git'));
  assert.ok(!text.includes('index 83db48f'));
  assert.ok(!text.includes('+++ b/src/greet.ts'), 'the +++ header must not appear as an added line');
});

test('both hunks are captured', () => {
  const hunks = parseDiff(SAMPLE);
  assert.equal(hunks.length, 2);
  assert.match(hunks[1]?.header ?? '', /^@@ -10,2 \+11,2 @@/);
});

test('stats count only real additions and deletions', () => {
  const stats = diffStats(parseDiff(SAMPLE));
  assert.equal(stats.additions, 3);
  assert.equal(stats.deletions, 2);
});

test('empty and malformed input yield no hunks rather than throwing', () => {
  assert.deepEqual(parseDiff(''), []);
  assert.deepEqual(parseDiff('not a diff at all'), []);
  assert.equal(countLines([]), 0);
});
