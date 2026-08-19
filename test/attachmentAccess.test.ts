import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Chat } from '../shared/types.ts';
import { buildArgs } from '../server/agent.ts';
import { attachmentsDir } from '../server/platform.ts';

/**
 * The agent's access to the attachments directory.
 *
 * THE BUG THIS PINS. Attachments are stored outside every repository — a screenshot is not part of anyone's
 * source tree — which puts them outside the session's working directory, where the CLI refuses tool access.
 * A pasted image produced:
 *
 *   "Claude requested permissions to read from ...\.flightdeck\attachments\...png,
 *    but you haven't granted it yet."
 *
 * and the run could not see the file at all. There is no approval channel to grant it through, so the
 * directory has to be allowed up front with `--add-dir`. Nothing about this fails loudly if it regresses:
 * the attachment simply becomes invisible to the agent.
 */
const chat: Chat = {
  id: 'c1',
  projectId: 'p1',
  parentChatId: null,
  title: 'Test',
  sessionId: '11111111-2222-3333-4444-555555555555',
  permissionMode: 'acceptEdits',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastMessageAt: null
};

test('the attachments directory is passed as an allowed directory', () => {
  const args = buildArgs(chat, false);
  const index = args.indexOf('--add-dir');
  assert.ok(index >= 0, '--add-dir is missing, so pasted files are unreadable to the agent');
  assert.equal(args[index + 1], attachmentsDir());
});

test('it is passed on a resumed session too', () => {
  // A resumed chat can refer back to a file attached several turns ago; being told "no" then is just as
  // useless as being told "no" the first time.
  const args = buildArgs(chat, true);
  assert.ok(args.includes('--add-dir'));
  assert.ok(args.includes('--resume'));
});

test('exactly one directory is granted, and it is one Flight Deck owns', () => {
  const args = buildArgs(chat, false);
  assert.equal(args.filter((arg) => arg === '--add-dir').length, 1);
  // Granting the home directory, or a project path, would hand the agent far more than it asked for.
  assert.match(attachmentsDir(), /[\\/]\.flightdeck[\\/]attachments$/);
});

test('the flag comes as its own argv entry, never concatenated', () => {
  const args = buildArgs(chat, false);
  // Rule 8: the path holds backslashes and can hold spaces. `--add-dir=C:\...` would also be wrong here.
  assert.ok(!args.some((arg) => arg.startsWith('--add-dir=')));
  assert.ok(args.every((arg) => typeof arg === 'string'));
});

test('there is one definition of the attachments directory', () => {
  // Two places computing this path is how the agent ends up allowed into a directory the writer no longer
  // uses — the failure would be an unreadable attachment with everything looking correct.
  const platform = readFileSync('server/platform.ts', 'utf8');
  assert.match(platform, /export function attachmentsDir\(\)/);

  for (const file of ['server/routes/attachments.ts', 'server/routes/storage.ts', 'server/agent.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /attachmentsDir/, `${file} should use the shared path`);
    assert.ok(
      !/join\(stateDir\(\), 'attachments'/.test(source),
      `${file} must not rebuild the attachments path itself`
    );
  }
});

test('the attachment write path still groups by day', () => {
  const source = readFileSync('server/routes/attachments.ts', 'utf8');
  // Grouping keeps the folder browsable after months of use; the grant covers the parent, so both hold.
  assert.match(source, /todayDir\(\)/);
  assert.match(source, /join\(attachmentsDir\(\), day\)/);
});
