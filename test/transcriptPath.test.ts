import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptEncode } from '../server/platform.ts';
import { findTranscript } from '../server/transcript.ts';

/**
 * Finding a session's transcript on disk.
 *
 * THE BUG THIS FIXES, reported from use: "when I open new chat and refresh the page, that prev chat won't be
 * visible". The chat was there and its transcript was on disk; the directory name we computed was one character
 * different from the one the CLI had written, so history replayed as nothing and the import dialog claimed
 * there were no sessions to import.
 *
 * The encoding is observed rather than documented, which is why it is tested against real directory names AND
 * backed by a scan. Being wrong about it again should cost a slower lookup, not a feature.
 */
test('every character that is not a letter or a digit becomes its own dash', () => {
  /*
   * The case that broke it: an underscore. A folder named `some_app` is written by the CLI as `some-app`, and
   * only `[\\/:]` was being replaced — so an ordinary project name resolved to a directory that does not
   * exist, on a machine where four projects out of five had one.
   */
  assert.equal(transcriptEncode('C:\\repos\\my_app'), 'C--repos-my-app');
  assert.equal(transcriptEncode('/home/dev/my_app'), '-home-dev-my-app');
  // A dot in a folder name, which is just as ordinary and would have broken the same way.
  assert.equal(transcriptEncode('C:\\repos\\site.v2'), 'C--repos-site-v2');
  // A space, and a dash that is already a dash.
  assert.equal(transcriptEncode('C:\\my repos\\web-app'), 'C--my-repos-web-app');
});

test('runs are never collapsed', () => {
  /*
   * `C:` plus a separator is two characters and therefore two dashes. Collapsing them with a `+` yields
   * `C-repos-app`, which exists nowhere — the other way to get this wrong, and the one the original comment
   * warned about while missing the underscore.
   */
  assert.equal(transcriptEncode('C:\\repos\\app'), 'C--repos-app');
  assert.ok(!transcriptEncode('C:\\repos\\app').includes('C-r'), 'the drive prefix must stay two dashes');
});

test('case is preserved, because the CLI preserves it', () => {
  // The drive letter arrives as the shell gave it — `E:\` from one, `e:\` from another — so both spellings of
  // the same directory exist on a real machine. Windows resolves either; `resolveTranscriptDir` covers the rest.
  assert.equal(transcriptEncode('C:\\Repos\\MyApp'), 'C--Repos-MyApp');
});

/** A projects root shaped like the real one, with the transcript filed under an unexpected name. */
function fixture(): { root: string; encoded: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-transcripts-'));
  const file = '7e6d1341-b739-4d1d-ad0d-7eaf469cc1c5.jsonl';
  // What the CLI actually wrote, which is not what a wrong encoder would compute.
  const actual = join(root, 'e--repos-my-app');
  mkdirSync(actual, { recursive: true });
  writeFileSync(join(actual, file), '{"type":"user"}\n', 'utf8');
  return { root, encoded: join(root, 'C--repos-different'), file };
}

test('a transcript filed under an unexpected directory name is still found', () => {
  const { root, encoded, file } = fixture();
  try {
    /*
     * The fallback that makes the next encoding change survivable. A session id is ours and unique, so a file
     * named after one is the transcript regardless of which directory the CLI decided to put it in.
     */
    const found = findTranscript(root, encoded, file);
    assert.notEqual(found, join(encoded, file), 'it should not have returned the path that does not exist');
    assert.ok(found.endsWith(file));
    assert.match(found, /e--repos-my-app/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the encoded path wins when it is right, without a scan', () => {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-transcripts-'));
  try {
    const file = 'aaaaaaaa-0000-0000-0000-000000000000.jsonl';
    const encoded = join(root, 'C--repos-my-app');
    mkdirSync(encoded, { recursive: true });
    writeFileSync(join(encoded, file), '{}\n', 'utf8');
    // Two directories hold a file of that name; the encoded one must be preferred.
    const decoy = join(root, 'z--somewhere-else');
    mkdirSync(decoy, { recursive: true });
    writeFileSync(join(decoy, file), '{}\n', 'utf8');

    assert.equal(findTranscript(root, encoded, file), join(encoded, file));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing session returns the encoded path rather than throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'flightdeck-transcripts-'));
  try {
    // A chat that has never run has no transcript, which is a normal state and not an error.
    const encoded = join(root, 'C--repos-my-app');
    assert.equal(findTranscript(root, encoded, 'nope.jsonl'), join(encoded, 'nope.jsonl'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a projects root that does not exist is not an error either', () => {
  // The CLI may never have run on this machine.
  const encoded = join(tmpdir(), 'flightdeck-absent', 'C--repos-my-app');
  assert.equal(findTranscript(join(tmpdir(), 'flightdeck-absent'), encoded, 'x.jsonl'), join(encoded, 'x.jsonl'));
});

test('every reader of a transcript goes through the resolver', () => {
  /*
   * Three features read these files — history replay, the import dialog and per-project usage — and all three
   * were broken by the same wrong directory name. A reader that computes the path itself would be a fourth.
   */
  for (const file of ['server/transcript.ts', 'server/routes/sessions.ts', 'server/transcriptUsage.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /resolveTranscriptDir|findTranscript/, `${file} resolves its own path`);
    assert.ok(!/transcriptDirFor\(/.test(source), `${file} should not use the unresolved encoding`);
  }
});
