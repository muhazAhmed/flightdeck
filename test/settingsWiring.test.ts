import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/types.ts';
import { buildArgs } from '../server/agent.ts';
import { measureAttachments } from '../server/routes/storage.ts';

/**
 * Every setting must actually do something.
 *
 * A preference that saves and changes nothing is worse than a disabled one: it looks like a feature
 * and behaves like a lie. These tests pin the wiring for each field added with the settings sections.
 */

const chat = {
  id: 'c1',
  projectId: 'p1',
  parentChatId: null,
  title: 'Test',
  sessionId: '11111111-2222-3333-4444-555555555555',
  permissionMode: 'acceptEdits' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastMessageAt: null
};

test('a turn cap reaches the CLI as --max-turns', () => {
  const args = buildArgs(chat, false, 30);
  const index = args.indexOf('--max-turns');
  assert.ok(index >= 0, 'flag missing');
  assert.equal(args[index + 1], '30');
});

test('no cap means the flag is absent entirely', () => {
  // `--max-turns 0` would end every run before it produced anything, so 0 must omit the flag rather
  // than pass a zero through.
  assert.ok(!buildArgs(chat, false, 0).includes('--max-turns'));
  assert.ok(!buildArgs(chat, false).includes('--max-turns'));
});

test('the turn cap does not disturb the flags the stream depends on', () => {
  const args = buildArgs(chat, false, 15);
  // --verbose is not optional: stream-json refuses to emit without it.
  for (const flag of ['-p', '--output-format', '--input-format', '--include-partial-messages', '--verbose']) {
    assert.ok(args.includes(flag), `${flag} missing`);
  }
  assert.ok(args.includes('--session-id'));
});

test('defaults are inert: a fresh install changes no CLI behaviour', () => {
  // Every added default must be the "do nothing" value, so installing an update cannot silently
  // change how runs behave.
  assert.equal(DEFAULT_SETTINGS.maxTurns, 0);
  assert.equal(DEFAULT_SETTINGS.defaultModel, '');
  assert.equal(DEFAULT_SETTINGS.draftModel, '');
  assert.equal(DEFAULT_SETTINGS.commitSignoff, false);
  assert.equal(DEFAULT_SETTINGS.terminalShell, '');
  assert.equal(DEFAULT_SETTINGS.defaultPermissionMode, 'acceptEdits');
});

test('every new setting is validated server-side', () => {
  const source = readFileSync('server/routes/settings.ts', 'utf8');
  for (const field of [
    'terminalFontSize',
    'terminalCursorBlink',
    'defaultModel',
    'draftModel',
    'defaultPermissionMode',
    'maxTurns',
    'commitSignoff'
  ]) {
    assert.ok(source.includes(`patch.${field} !== undefined`), `${field} is not validated`);
  }
  // A free-text model id reaches the CLI as `--model claude-opus-6` and fails per run with an error
  // that reads like a Flight Deck bug.
  assert.match(source, /MODEL_OPTIONS\.some/);
});

test('the model default collapses to undefined, never an empty string', () => {
  const source = readFileSync('server/routes/chats.ts', 'utf8');
  // `--model ""` is an error; the field has to be absent for the CLI to use its own default.
  assert.match(source, /model: model\?\.trim\(\) \|\| s\.settings\?\.defaultModel \|\| undefined/);
});

test('sign-off is applied through git, not by editing the message text', () => {
  const source = readFileSync('server/routes/git.ts', 'utf8');
  // `--signoff` uses the identity git will attribute the commit to, so the trailer cannot disagree
  // with the author line — appending the text ourselves could.
  assert.match(source, /'--signoff': null/);
  assert.match(source, /state\.read\(\)\.settings\?\.commitSignoff/);
});

test('the draft model falls back to the setting only when the request pins nothing', () => {
  const source = readFileSync('server/routes/commitMessage.ts', 'utf8');
  assert.match(source, /req\.body\?\.model \|\| state\.read\(\)\.settings\?\.draftModel \|\| undefined/);
});

test('a new project inherits the configured permission mode', () => {
  const source = readFileSync('server/routes/projects.ts', 'utf8');
  assert.match(source, /s\.settings\?\.defaultPermissionMode \?\? 'acceptEdits'/);
});

test('purging attachments builds its path server-side', () => {
  const source = readFileSync('server/routes/storage.ts', 'utf8');
  // The whole safety of a recursive delete is that the client cannot name the directory. The path comes
  // from platform.ts, which is the one place allowed to know machine-specific locations.
  assert.match(source, /attachmentsDir\(\)/);
  assert.match(source, /from '\.\.\/platform\.js'/);
  assert.ok(!/req\.(body|query|params)/.test(source), 'the delete path must not come from the client');
});

test('terminal appearance changes mutate the live instance instead of recreating it', () => {
  const source = readFileSync('client/features/terminal/useTerminal.ts', 'utf8');
  // Recreating the terminal closes its socket, and the server kills the shell when the socket
  // closes — so nudging the font size would end a running build.
  assert.match(source, /terminal\.options\.fontSize = appearance\.fontSize/);
  const creation = source.slice(source.indexOf('const initial = appearanceRef.current'));
  const deps = creation.slice(creation.indexOf('}, [projectId'), creation.indexOf('}, [projectId') + 60);
  assert.ok(!deps.includes('appearance'), `appearance must not be a dependency of the creation effect: ${deps}`);
});

/**
 * Attachment accounting, against a temporary tree.
 *
 * The purge route itself is deliberately not called in a test: it deletes a real home directory's
 * attachments, and a test that destroys the developer's own files to prove it works is not a test
 * worth having. The measuring half is where the logic lives, so that is what is exercised.
 */
test('attachments are counted across the day subdirectories they are stored in', () => {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-att-'));
  try {
    mkdirSync(join(root, '2026-08-18'));
    mkdirSync(join(root, '2026-08-19'));
    writeFileSync(join(root, '2026-08-18', 'a.png'), Buffer.alloc(100));
    writeFileSync(join(root, '2026-08-19', 'b.txt'), Buffer.alloc(250));
    writeFileSync(join(root, '2026-08-19', 'c.txt'), Buffer.alloc(1));

    const result = measureAttachments(root);
    assert.equal(result.count, 3);
    assert.equal(result.bytes, 351);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing attachments directory reports zero rather than throwing', () => {
  // A fresh install has never written one, and the Privacy section still has to render.
  const result = measureAttachments(join(tmpdir(), 'flightdeck-does-not-exist-9e3f'));
  assert.deepEqual(result, { count: 0, bytes: 0 });
});
