import test from 'node:test';
import assert from 'node:assert/strict';
import { pairHunkLines, SIMILARITY_FLOOR, tokenize, wordDiff } from '../client/features/changes/wordDiff.ts';

/**
 * Word-level highlighting.
 *
 * Worth testing carefully because a near-miss is worse than nothing: highlighting slightly the wrong range
 * points the reader at the wrong token with complete confidence, and looks correct while doing it.
 */

/** The changed text on one side, which is what a reader's eye is drawn to. */
function marked(segments: { text: string; changed: boolean }[]): string {
  return segments.filter((segment) => segment.changed).map((segment) => segment.text).join('|');
}

/** Segments must always reassemble into the original line, or the renderer silently drops characters. */
function assertLossless(segments: { text: string; changed: boolean }[], original: string): void {
  assert.equal(segments.map((s) => s.text).join(''), original, 'segments must reassemble exactly');
}

test('a renamed identifier highlights only the identifier', () => {
  const diff = wordDiff('const user = getUser(id);', 'const user = getUserById(id);');
  assert.ok(diff);
  assertLossless(diff.removed, 'const user = getUser(id);');
  assertLossless(diff.added, 'const user = getUserById(id);');
  assert.equal(marked(diff.removed), 'getUser');
  assert.equal(marked(diff.added), 'getUserById');
});

test('a changed string highlights the string, not the whole call', () => {
  const diff = wordDiff("toast.error('failed');", "toast.error('could not save');");
  assert.ok(diff);
  // The quotes are shared; only the words inside them moved.
  assert.ok(marked(diff.added).includes('could'));
  assert.ok(!marked(diff.added).includes('toast'));
});

test('a number change highlights the number', () => {
  const diff = wordDiff('const timeout = 5000;', 'const timeout = 30000;');
  assert.ok(diff);
  assert.equal(marked(diff.removed), '5000');
  assert.equal(marked(diff.added), '30000');
});

test('an appended argument marks only what was added', () => {
  const diff = wordDiff('run(a);', 'run(a, b);');
  assert.ok(diff);
  assert.equal(marked(diff.removed), '', 'nothing was removed');
  assert.ok(marked(diff.added).includes('b'));
});

test('identical lines are not highlighted at all', () => {
  assert.equal(wordDiff('same();', 'same();'), null);
});

test('a whitespace-only difference is left plain', () => {
  // The tokens are equal; only the runs between them changed. There is nothing to point at.
  assert.equal(wordDiff('a( b );', 'a(  b  );'), null);
});

test('two unrelated lines are left plain rather than striped', () => {
  // Highlighting a rewrite word by word produces noise that hides the shape of the change.
  assert.equal(wordDiff('import { readFile } from "node:fs";', 'export const PAGE_SIZE = 50;'), null);
});

test('lines sharing only their indentation are left plain', () => {
  // Shared whitespace is not shared meaning, which is why similarity ignores it.
  assert.equal(wordDiff('    alpha(beta, gamma);', '    delta(epsilon, zeta);'), null);
});

test('the similarity floor is what separates an edit from a replacement', () => {
  assert.ok(SIMILARITY_FLOOR > 0 && SIMILARITY_FLOOR < 1);
  // Half the tokens shared reads as an edit.
  assert.ok(wordDiff('const a = compute(x, y);', 'const a = compute(x, z);'));
});

test('an empty side is left plain', () => {
  assert.equal(wordDiff('', 'added();'), null);
  assert.equal(wordDiff('removed();', ''), null);
});

test('a generated or minified line is skipped rather than diffed', () => {
  const long = `const x = ${'a'.repeat(2100)};`;
  assert.equal(wordDiff(long, `${long}b`), null);
});

test('tokenizing keeps identifiers whole and separates punctuation', () => {
  assert.deepEqual(tokenize('a.b(c);'), ['a', '.', 'b', '(', 'c', ')', ';']);
  // `$` and `_` belong to identifiers in JavaScript, so they must not split one.
  assert.deepEqual(tokenize('$my_var'), ['$my_var']);
  assert.deepEqual(tokenize('a  b'), ['a', '  ', 'b']);
});

test('segments always reassemble, whatever the input', () => {
  const pairs = [
    ['const a = 1;', 'const a = 2;'],
    ['  indented(x)', '  indented(y)'],
    ['a(b, c, d)', 'a(b, d)'],
    ['x', 'x + 1']
  ];
  for (const [before, after] of pairs) {
    const diff = wordDiff(before!, after!);
    if (!diff) continue;
    assertLossless(diff.removed, before!);
    assertLossless(diff.added, after!);
  }
});

test('pairing matches the nth removal with the nth addition', () => {
  const lines = [
    { kind: 'context', text: 'before' },
    { kind: 'del', text: 'const a = 1;' },
    { kind: 'del', text: 'const b = 2;' },
    { kind: 'add', text: 'const a = 10;' },
    { kind: 'add', text: 'const b = 20;' },
    { kind: 'context', text: 'after' }
  ];
  const paired = pairHunkLines(lines);
  // git emits a run of removals then a run of additions, so index 1 pairs with 3 and 2 with 4.
  assert.ok(paired.has(1) && paired.has(3));
  assert.equal(marked(paired.get(1)!.removed), '1');
  assert.equal(marked(paired.get(3)!.added), '10');
  assert.equal(marked(paired.get(2)!.removed), '2');
  assert.ok(!paired.has(0) && !paired.has(5), 'context lines are never paired');
});

test('unequal runs leave the extras plain', () => {
  const lines = [
    { kind: 'del', text: 'const a = 1;' },
    { kind: 'add', text: 'const a = 2;' },
    { kind: 'add', text: 'const brandNew = 3;' }
  ];
  const paired = pairHunkLines(lines);
  assert.ok(paired.has(0) && paired.has(1));
  assert.ok(!paired.has(2), 'an addition with no counterpart has nothing to compare against');
});

test('separate runs in one hunk are paired independently', () => {
  const lines = [
    { kind: 'del', text: 'first(a);' },
    { kind: 'add', text: 'first(b);' },
    { kind: 'context', text: 'gap' },
    { kind: 'del', text: 'second(c);' },
    { kind: 'add', text: 'second(d);' }
  ];
  const paired = pairHunkLines(lines);
  // A removal after a context line starts a new run rather than pairing across the gap.
  assert.equal(marked(paired.get(0)!.removed), 'a');
  assert.equal(marked(paired.get(3)!.removed), 'c');
});

test('an addition-only hunk pairs nothing', () => {
  const paired = pairHunkLines([
    { kind: 'add', text: 'one();' },
    { kind: 'add', text: 'two();' }
  ]);
  assert.equal(paired.size, 0);
});
