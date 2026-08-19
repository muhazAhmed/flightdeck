import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { detect, defaultProfile, find, resetCache } from '../server/shells.ts';

/**
 * Shell detection. Worth testing because the failure mode is confusing rather than loud: a bad path
 * makes node-pty throw somewhere deep inside ConPTY with no hint that the shell was the problem.
 *
 * These assertions are about shape and invariants, not about which shells this particular machine
 * has — the whole point of detection is that the answer differs per machine.
 */
test('every detected profile points at something that exists', () => {
  resetCache();
  const profiles = detect();
  assert.ok(profiles.length > 0, 'no shell detected at all — every OS has at least one');

  for (const profile of profiles) {
    assert.ok(profile.id.length > 0);
    assert.ok(profile.label.length > 0);
    assert.ok(Array.isArray(profile.args));
    assert.ok(existsSync(profile.path), `${profile.label} resolved to a missing path: ${profile.path}`);
  }
});

test('ids are unique, so a picker cannot show two of the same option', () => {
  resetCache();
  const ids = detect().map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);
});

test('no detected path contains an unescaped drive literal', () => {
  resetCache();
  // The bug this pins: 'C:\Windows' in a JS literal drops the backslash and yields "C:Windows",
  // which resolves to nothing.
  for (const profile of detect()) {
    assert.ok(!/^[a-zA-Z]:[^\\/]/.test(profile.path), `unescaped path leaked through: ${profile.path}`);
  }
});

test('find returns null for an unknown or missing id, so a stale setting cannot break a terminal', () => {
  resetCache();
  assert.equal(find(undefined), null);
  assert.equal(find(''), null);
  assert.equal(find('wsl:a-distro-nobody-has'), null);
});

test('find round-trips every detected id', () => {
  resetCache();
  for (const profile of detect()) {
    assert.equal(find(profile.id)?.path, profile.path);
  }
});

test('FLIGHTDECK_SHELL wins, so anyone can choose something detection missed', () => {
  const previous = process.env.FLIGHTDECK_SHELL;
  process.env.FLIGHTDECK_SHELL = '/usr/bin/nushell';
  try {
    resetCache();
    assert.equal(defaultProfile().path, '/usr/bin/nushell');
  } finally {
    if (previous === undefined) delete process.env.FLIGHTDECK_SHELL;
    else process.env.FLIGHTDECK_SHELL = previous;
    resetCache();
  }
});

test('the default is a real profile when no override is set', () => {
  const previous = process.env.FLIGHTDECK_SHELL;
  delete process.env.FLIGHTDECK_SHELL;
  try {
    resetCache();
    const profile = defaultProfile();
    assert.ok(existsSync(profile.path), `default shell does not exist: ${profile.path}`);
  } finally {
    if (previous !== undefined) process.env.FLIGHTDECK_SHELL = previous;
    resetCache();
  }
});

/**
 * `wsl --list --quiet` writes UTF-16LE. Decoding it as UTF-8 yields NUL-interleaved names that then
 * fail to launch — a bug that would pass a "returns an array of strings" test, so pin the decode
 * itself rather than the result.
 */
test('WSL output is decoded as utf16le, not utf8', () => {
  const source = readFileSync('server/shells.ts', 'utf8');
  assert.ok(source.includes("toString('utf16le')"), 'wsl --list output must be decoded as utf16le');
  assert.ok(!source.includes("toString('utf8')"));
});
