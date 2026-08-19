import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

/**
 * The update check as the client performs it.
 *
 * These are structural, because the interesting properties are about *when* a request happens rather than what
 * it returns — and "does not phone home on every reload" cannot be asserted from a return value.
 */
const hook = readFileSync('client/features/updates/useUpdateCheck.ts', 'utf8');
const section = readFileSync('client/features/settings/sections/UpdatesSection.tsx', 'utf8');
const server = readFileSync('server/update.ts', 'utf8');
const route = readFileSync('server/routes/update.ts', 'utf8');
const shell = readFileSync('client/app/AppShell.tsx', 'utf8');

test('the check is on by default, since a fork that never hears about updates is the point of the feature', () => {
  assert.equal(DEFAULT_SETTINGS.checkForUpdates, true);
});

test('nothing is read or fetched when the setting is off', () => {
  assert.match(hook, /if \(enabled\) void load\(\)/);
  // Also enforced server-side, so the setting holds even if something calls the route directly.
  assert.match(route, /checkForUpdates === false/);
  assert.match(route, /'DISABLED'/);
});

test('the network is only reached when what we know is stale', () => {
  // A local read is free; a fetch is an outbound request. Doing the second on every reload would make the
  // privacy section untrue.
  assert.match(hook, /const STALE_AFTER_MS = \d+ \* 60 \* 60 \* 1000/);
  assert.match(hook, /age < STALE_AFTER_MS\) return/);
});

test('the toast fires once per launch and carries an action', () => {
  assert.match(hook, /announced\.current = true/);
  assert.match(hook, /action: \{ label: 'View'/);
  // The action has to land somewhere that explains itself, which is the Updates section.
  assert.match(shell, /useUpdateCheck\([\s\S]{0,80}setView\('settings'\)/);
});

test('the toast only appears when the install is actually behind', () => {
  assert.match(hook, /next\.state !== 'behind'\) return/);
});

test('update checks compare against the install own remote, never a hardcoded repository', () => {
  // A fork must be told about the fork. A hardcoded upstream would report the wrong thing, and a web API
  // would need a token and a rate-limit story.
  assert.ok(!/api\.github\.com/.test(server), 'no third-party API');
  assert.ok(!/github\.com/.test(server), 'no hardcoded repository');
  assert.match(server, /'@\{u\}'/);
});

test('the apply button is only rendered when a fast-forward is possible', () => {
  // A visible button that would refuse is worse than no button.
  assert.match(section, /behind && !status\.dirty \?/);
});

test('every update state has its own sentence', () => {
  for (const state of ['behind', 'up-to-date', 'ahead', 'diverged', 'no-upstream', 'not-a-repo']) {
    assert.ok(section.includes(`case '${state}'`), `${state} has no headline`);
  }
});

test('the update path is read-only except for one fast-forward', () => {
  const writes = server.match(/runGit\([^,]+, \[[^\]]+\]/g) ?? [];
  const mutating = writes.filter((call) => /'merge'|'pull'|'reset'|'checkout'|'rebase'/.test(call));
  assert.equal(mutating.length, 1, `expected exactly one mutating git call, found: ${mutating.join(' | ')}`);
  assert.match(mutating[0] ?? '', /'--ff-only'/);
});
