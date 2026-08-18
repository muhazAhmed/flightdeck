import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { transcriptDirFor } from '../server/platform.ts';

/**
 * The transcript directory encoding is undocumented — it was read off disk. It is also
 * silent when wrong: a mis-encoded path finds no transcript, so a chat reopens empty with
 * nothing to explain why. That is exactly the kind of bug worth pinning.
 */
const projects = (name: string) => join(homedir(), '.claude', 'projects', name);

test('a windows path encodes the drive colon and each separator as its own dash', () => {
  assert.equal(transcriptDirFor('E:\\muhaz\\flightdeck'), projects('E--muhaz-flightdeck'));
});

test('a posix path encodes its leading slash too', () => {
  assert.equal(transcriptDirFor('/home/dev/app'), projects('-home-dev-app'));
});

test('runs of separators are NOT collapsed — that was the bug', () => {
  // `C://weird//path` has adjacent separators; collapsing them would produce
  // `C-weird-path`, which matches no directory on disk.
  assert.equal(transcriptDirFor('C://weird//path'), projects('C---weird--path'));
});
