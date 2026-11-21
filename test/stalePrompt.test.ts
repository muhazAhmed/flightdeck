import test from 'node:test';
import assert from 'node:assert/strict';
import { isStalePrompt } from '../client/features/terminal/stalePrompt.ts';

/**
 * When it is safe to press Enter in the user's shell so the prompt redraws after a UI branch switch.
 *
 * The cases that must stay false matter more than the ones that are true: a wrong "yes" submits a
 * half-typed command or answers a program's question.
 */
const GIT_BASH_ABOVE = 'dev@box MINGW64 /c/repos/app (dev)';

test('an empty two-line Git Bash prompt naming the old branch is stale', () => {
  assert.equal(isStalePrompt(GIT_BASH_ABOVE, '$ ', 2, 'dev'), true);
});

test('a one-line prompt naming the old branch is stale', () => {
  const line = 'dev@box:/home/dev/app (dev)$ ';
  assert.equal(isStalePrompt('', line, line.length, 'dev'), true);
});

test('a half-typed command is never submitted', () => {
  assert.equal(isStalePrompt(GIT_BASH_ABOVE, '$ git push --force', 18, 'dev'), false);
});

test('a prompt that does not name the old branch is left alone', () => {
  assert.equal(isStalePrompt('C:/repos/app', 'PS C:/repos/app> ', 17, 'dev'), false);
});

test('output from a running program is not a prompt', () => {
  assert.equal(isStalePrompt('  VITE ready on branch dev', '  press h + enter to show help', 30, 'dev'), false);
});

test('a cursor parked elsewhere on the line is not an idle prompt', () => {
  assert.equal(isStalePrompt(GIT_BASH_ABOVE, '$ ', 0, 'dev'), false);
});

test('no known previous branch means no nudge', () => {
  assert.equal(isStalePrompt(GIT_BASH_ABOVE, '$ ', 2, ''), false);
});
