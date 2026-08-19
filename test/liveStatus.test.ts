import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDebouncer } from '../client/lib/debounce.ts';
import { touchesWorkingTree } from '../client/features/chat/touchesWorkingTree.ts';

/**
 * Refreshing the Changes panel while the agent works.
 *
 * The failure modes here are all quiet: a missed tool name leaves the panel looking stale, a broken
 * deadline makes a long run go silent, and a loud refresh spins the Fetch button for no reason. None
 * of them throw, so each is pinned deliberately.
 */

test('tools that write files are recognised', () => {
  for (const name of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Task']) {
    assert.equal(touchesWorkingTree(name), true, `${name} should count as a writer`);
  }
});

/**
 * Pinned from a real `system/init` handshake on Windows, which advertised:
 * Task, Edit, Glob, Grep, NotebookEdit, PowerShell, Read, Skill, WebFetch, WebSearch, Write —
 * and **no Bash**. Assuming the shell tool is called `Bash` everywhere would have silently skipped
 * every refresh after a shell command on this platform.
 */
test('the shell tool counts as a writer under either platform name', () => {
  assert.equal(touchesWorkingTree('PowerShell'), true);
  assert.equal(touchesWorkingTree('Bash'), true);
});

test('read-only and unknown tools do not trigger a refresh', () => {
  // A refresh per Read during a twenty-file exploration is pure noise. Unknown names (MCP tools)
  // deliberately count as read-only: the run ending refreshes anyway, so the cost is a delay, never
  // a missed update.
  for (const name of ['Read', 'Glob', 'Grep', 'WebFetch', 'TodoWrite', 'Skill', 'mcp__blender__get_scene_info', '']) {
    assert.equal(touchesWorkingTree(name), false, `${name} should not count as a writer`);
  }
});

test('a burst of calls collapses into one', async () => {
  let fired = 0;
  const debouncer = createDebouncer(() => fired++, 30, 500);
  for (let i = 0; i < 10; i++) debouncer.call();
  assert.equal(fired, 0, 'must not fire on the leading edge — the first Edit of five is not the news');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(fired, 1);
});

test('the deadline fires during a burst that never pauses', async () => {
  // The bug this pins: a plain trailing debounce fed a call every 10ms would never fire at all, and
  // a long run would show no file changes until it ended.
  let fired = 0;
  const debouncer = createDebouncer(() => fired++, 50, 120);
  const started = Date.now();
  while (Date.now() - started < 260) {
    debouncer.call();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  debouncer.cancel();
  assert.ok(fired >= 1, `deadline never fired (${fired})`);
  assert.ok(fired <= 4, `fired too often for a 120ms deadline over 260ms (${fired})`);
});

test('cancel stops a pending call', async () => {
  let fired = 0;
  const debouncer = createDebouncer(() => fired++, 20, 200);
  debouncer.call();
  debouncer.cancel();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fired, 0);
});

/**
 * Structural assertions. These paths need a browser and a live agent run to exercise properly, so
 * what is checked here is that the wiring exists at all — each of these was a real bug risk while
 * building it.
 */
test('the stream correlates writer tools by id, since tool_result carries no name', () => {
  const source = readFileSync('client/features/chat/useChatStream.ts', 'utf8');
  // tool_start is the only event with a `name`; matching on `event.name` in a tool_result branch
  // typechecks against the union and then never matches anything.
  assert.match(source, /event\.type === 'tool_start' && touchesWorkingTree\(event\.name\)/);
  assert.match(source, /event\.type === 'tool_result' && writerCalls\.current\.has\(event\.id\)/);
});

test('history replay does not announce that files were touched', () => {
  const source = readFileSync('client/features/chat/useChatStream.ts', 'utf8');
  const hydrate = source.slice(source.indexOf('const hydrate'));
  // Replaying a transcript full of Edits describes work that finished hours ago.
  assert.ok(!hydrate.includes('enqueue('), 'hydrate must bypass enqueue');
});

test('a quiet refresh neither shows a spinner nor clears the panel on failure', () => {
  const source = readFileSync('client/features/changes/useGitPanel.ts', 'utf8');
  assert.match(source, /if \(!options\?\.quiet\) setLoading\(true\)/);
  assert.match(source, /if \(!options\?\.quiet\) setError\(messageOf\(err\)\)/);
  // Adopting a status read that raced the user's own stage or commit would show the wrong list.
  assert.match(source, /if \(options\?\.quiet && busyRef\.current\) return/);
});

test('revision bumps refresh quietly, and only after the first render', () => {
  const source = readFileSync('client/features/changes/useGitPanel.ts', 'utf8');
  assert.match(source, /revision === firstRevision\.current/);
  assert.match(source, /refresh\(\{ quiet: true \}\)/);
});
