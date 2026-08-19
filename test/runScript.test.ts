import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand, scriptsFor } from '../server/scripts.ts';
import { useWorkspace } from '../client/store/workspace.ts';

/**
 * Running a project's scripts.
 *
 * The command is typed into the terminal rather than run server-side, and that is the design rather than a shortcut:
 * a dev server prints continuously, is stopped with `Ctrl+C`, and should die with its shell. Everything about it then
 * behaves as it does when typed by hand.
 *
 * Verified against the real projects on this machine: npm/`dev` for three of them, and a project with both `dev` and
 * `start` correctly preferring `dev`.
 */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-scripts-'));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents, 'utf8');
  return dir;
}

function withProject(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = project(files);
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PACKAGE = JSON.stringify({
  name: 'demo',
  scripts: { dev: 'vite', build: 'vite build', test: 'node --test' }
});

test('scripts are read with their commands, spelled for the package manager', () => {
  withProject({ 'package.json': PACKAGE }, (dir) => {
    const found = scriptsFor(dir);
    assert.equal(found.manager, 'npm');
    assert.deepEqual(
      found.scripts.map((script) => script.name),
      ['dev', 'build', 'test']
    );
    // The command is shown because a name like `dev:all` says nothing about what it starts.
    assert.equal(found.scripts[0]?.command, 'vite');
    assert.equal(found.scripts[0]?.run, 'npm run dev');
  });
});

test('dev wins over start, because start is usually the production entry point', () => {
  withProject({ 'package.json': JSON.stringify({ scripts: { start: 'next start', dev: 'next dev' } }) }, (dir) => {
    assert.equal(scriptsFor(dir).suggested, 'dev');
  });
});

test('start is suggested when there is no dev', () => {
  withProject({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }) }, (dir) => {
    assert.equal(scriptsFor(dir).suggested, 'start');
  });
});

test('a project with scripts but none that start it suggests nothing', () => {
  withProject({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) }, (dir) => {
    const found = scriptsFor(dir);
    assert.equal(found.suggested, null);
    // The scripts are still listed — the dropdown can run them, there is just no obvious primary.
    assert.equal(found.scripts.length, 1);
  });
});

test('the package manager comes from the lockfile', () => {
  withProject({ 'package.json': PACKAGE, 'pnpm-lock.yaml': 'lockfileVersion: 9' }, (dir) => {
    assert.equal(scriptsFor(dir).manager, 'pnpm');
    assert.equal(scriptsFor(dir).scripts[0]?.run, 'pnpm run dev');
  });
  withProject({ 'package.json': PACKAGE, 'yarn.lock': '# yarn' }, (dir) => {
    assert.equal(scriptsFor(dir).manager, 'yarn');
    // Only yarn omits the word `run`.
    assert.equal(scriptsFor(dir).scripts[0]?.run, 'yarn dev');
  });
  withProject({ 'package.json': PACKAGE, 'bun.lock': '' }, (dir) => {
    assert.equal(scriptsFor(dir).manager, 'bun');
  });
});

test('a newer lockfile wins over a stale package-lock', () => {
  // A repository mid-migration often still carries package-lock.json; the maintained lockfile is the newer one.
  withProject({ 'package.json': PACKAGE, 'package-lock.json': '{}', 'pnpm-lock.yaml': '' }, (dir) => {
    assert.equal(scriptsFor(dir).manager, 'pnpm');
  });
});

test('run spelling is correct for every manager', () => {
  assert.equal(runCommand('npm', 'dev'), 'npm run dev');
  assert.equal(runCommand('pnpm', 'dev'), 'pnpm run dev');
  assert.equal(runCommand('bun', 'dev'), 'bun run dev');
  assert.equal(runCommand('yarn', 'dev'), 'yarn dev');
});

test('a project that is not a Node project offers nothing rather than failing', () => {
  withProject({ 'Makefile': 'all:\n\techo hi\n' }, (dir) => {
    const found = scriptsFor(dir);
    assert.deepEqual(found.scripts, []);
    assert.equal(found.suggested, null);
  });
});

test('a malformed package.json is not an error', () => {
  // It is the project's problem, not something to fail a request over.
  withProject({ 'package.json': '{ "scripts": { "dev": ' }, (dir) => {
    assert.deepEqual(scriptsFor(dir).scripts, []);
  });
});

test('a scripts field that is not an object is ignored', () => {
  withProject({ 'package.json': JSON.stringify({ scripts: 'nonsense' }) }, (dir) => {
    assert.deepEqual(scriptsFor(dir).scripts, []);
  });
});

test('non-string script bodies are dropped', () => {
  withProject({ 'package.json': JSON.stringify({ scripts: { dev: 'vite', broken: { nested: true } } }) }, (dir) => {
    assert.deepEqual(
      scriptsFor(dir).scripts.map((script) => script.name),
      ['dev']
    );
  });
});

/** The queue that lets a button outside the terminal type into it. */
test('running a script opens the terminal and queues the command', () => {
  useWorkspace.setState({ terminalOpen: false, pendingCommand: null });
  useWorkspace.getState().runInTerminal('npm run dev');

  const state = useWorkspace.getState();
  // Opening and queueing in one action: without the queue the command would be written to a socket that does not
  // exist yet and vanish.
  assert.equal(state.terminalOpen, true);
  assert.equal(state.pendingCommand, 'npm run dev');

  useWorkspace.getState().clearPendingCommand();
  assert.equal(useWorkspace.getState().pendingCommand, null);
});

test('the terminal types the queued command only once the shell is ready', () => {
  const source = readFileSync('client/features/terminal/useTerminal.ts', 'utf8');
  assert.match(source, /if \(!pendingCommand \|\| status\.state !== 'ready'\) return/);
  // Cleared as it is written, so a re-render cannot type it twice.
  assert.ok(source.indexOf('socket.send(JSON.stringify({ type: \'input\', data: pendingCommand + ENTER }))') <
    source.indexOf('clearPendingCommand();'));
});

test('Enter is a named constant, not an invisible character in a template', () => {
  /*
   * It was written as a literal carriage return inside a template literal, where it is invisible — and the first tool
   * to normalise line endings turns it into CRLF or drops it, after which the command is typed into the prompt and
   * never runs.
   */
  const source = readFileSync('client/features/terminal/useTerminal.ts', 'utf8');
  assert.match(source, /const ENTER = String\.fromCharCode\(13\)/);
  assert.ok(!source.includes('${pendingCommand}\r'), 'no literal CR in a template');
});

test('the button lives in the chat header and disappears when there is nothing to run', () => {
  const button = readFileSync('client/features/chat/RunScriptButton.tsx', 'utf8');
  const header = readFileSync('client/features/chat/ChatHeader.tsx', 'utf8');
  assert.match(header, /<RunScriptButton projectId=\{project\.id\} \/>/);
  assert.match(button, /if \(!scripts \|\| scripts\.scripts\.length === 0\) return null/);
  // And it says where the output goes, since that is the part that is not obvious from a play icon.
  assert.match(button, /typed into the terminal, so Ctrl\+C stops it/);
});

test('the split control is one bordered container, not two boxes side by side', () => {
  /*
   * The bug: the two halves each carried their own border, meant to abut. At some zoom levels and device pixel ratios
   * the adjacent borders render as a visible gap, so it read as two separate controls. The border and background now
   * live on the wrapper, the children carry neither, and a single left border acts as the divider.
   */
  const button = readFileSync('client/features/chat/RunScriptButton.tsx', 'utf8');
  assert.match(button, /overflow-hidden rounded-md border border-border-default bg-surface-2/);
  assert.ok(!button.includes('rounded-l-md'), 'no half-rounded children');
  assert.ok(!button.includes('border-r-0'), 'no borders meant to abut');
  // The divider only exists when there is something to its left.
  assert.match(button, /primary && 'border-l border-border-subtle'/);
});

