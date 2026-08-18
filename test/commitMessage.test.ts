import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOneShotArgs } from '../server/oneshot.ts';
import { buildPrompt, cleanMessage, MAX_DIFF_CHARS } from '../server/routes/commitMessage.ts';

/**
 * THE BUG THIS FILE EXISTS FOR: the prompt was passed as a command-line argument. A
 * commit-message prompt carries a diff, Windows caps a command line at ~32,767 characters, and a
 * real staged diff (164,385 chars in the repository that found this) made `spawn` fail with
 * ENAMETOOLONG — surfacing as a 500 with nothing useful in it. The prompt now travels on stdin.
 */
test('the prompt is never part of argv — it goes on stdin', () => {
  const args = buildOneShotArgs([]);
  // `-p` with no following value is the pipe form; a prompt-shaped argument here is the bug.
  const promptIndex = args.indexOf('-p');
  assert.ok(promptIndex >= 0, 'the print flag must be present');
  assert.equal(args[promptIndex + 1], '--output-format', 'nothing may sit between -p and the next flag');
  for (const arg of args) {
    assert.ok(arg.length < 100, `argv entry looks like content rather than a flag: ${arg.slice(0, 40)}…`);
  }
});

test('write-capable tools are denied on every one-shot call', () => {
  const args = buildOneShotArgs([]);
  const denied = args.slice(args.indexOf('--disallowedTools') + 1);
  for (const tool of ['Edit', 'Write', 'Bash', 'NotebookEdit', 'Task']) {
    assert.ok(denied.includes(tool), `${tool} must be denied to an internal helper`);
  }
});

test('a shim prefix is preserved ahead of our flags', () => {
  const args = buildOneShotArgs(['/d', '/s', '/c', 'claude']);
  assert.deepEqual(args.slice(0, 4), ['/d', '/s', '/c', 'claude']);
});

test('a pinned model is passed through; the default is left alone', () => {
  assert.ok(!buildOneShotArgs([]).includes('--model'));
  const pinned = buildOneShotArgs([], 'claude-haiku-4-5');
  assert.equal(pinned[pinned.indexOf('--model') + 1], 'claude-haiku-4-5');
});

test('truncation is disclosed inside the prompt, not just to the caller', () => {
  const whole = buildPrompt('1 file changed', 'diff body', false);
  const partial = buildPrompt('1 file changed', 'diff body', true);
  assert.ok(!whole.includes('TRUNCATED'));
  assert.match(partial, /TRUNCATED/);
  // The model must be told not to imply completeness, or it writes a confident, wrong summary.
  assert.match(partial, /do not claim it is complete/i);
  assert.match(partial, new RegExp(String(MAX_DIFF_CHARS)));
});

test('the prompt forbids committing and asks for the message only', () => {
  const prompt = buildPrompt('1 file changed', 'diff body', false);
  assert.match(prompt, /Output ONLY the commit message/);
  assert.match(prompt, /under 72 characters/);
});

test('code fences are stripped — backticks must not reach a commit subject', () => {
  assert.equal(cleanMessage('```\nFix the thing\n```'), 'Fix the thing');
  assert.equal(cleanMessage('```text\nFix the thing\n\nBecause reasons\n```'), 'Fix the thing\n\nBecause reasons');
  assert.equal(cleanMessage('  Fix the thing  '), 'Fix the thing');
  // A fence in the middle of a body is content, not wrapping, and must survive.
  const withBlock = 'Fix the thing\n\nExample:\n```ts\nconst a = 1;\n```';
  assert.equal(cleanMessage(withBlock), withBlock);
});
