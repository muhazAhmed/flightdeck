import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, safeName } from '../server/routes/attachments.ts';

/**
 * A file name arrives from a browser, which means it arrives from wherever the user dragged it
 * from — including names crafted to escape the directory we intend to write into. The uuid prefix
 * guarantees uniqueness, so this function's only job is to make the name safe and still legible.
 */
/** Built from a char code so the literal survives every tool that rewrites this file. */
const BS = String.fromCharCode(92);

test('path separators cannot survive into the written name', () => {
  assert.equal(safeName('../../etc/passwd'), '..-..-etc-passwd');
  assert.equal(safeName(`..${BS}..${BS}windows${BS}system32`), '..-..-windows-system32');
  for (const name of ['../../x', 'a/b/c', `a${BS}b${BS}c`]) {
    const safe = safeName(name);
    assert.ok(!safe.includes('/') && !safe.includes(BS), `separator survived in ${safe}`);
  }
});

test('characters a filesystem dislikes are replaced, not dropped silently', () => {
  assert.equal(safeName('screen shot (1).png'), 'screen-shot-1-.png');
  assert.equal(safeName('report:final?.pdf'), 'report-final-.pdf');
});

test('a name that sanitises to nothing still produces a usable file', () => {
  assert.equal(safeName('///'), 'attachment');
  assert.equal(safeName('   '), 'attachment');
  assert.equal(safeName('***'), 'attachment');
});

test('an absurd name is truncated rather than handed to the filesystem', () => {
  const long = `${'a'.repeat(400)}.png`;
  assert.ok(safeName(long).length <= 80);
});

test('the extension is preserved, since it decides image vs file', () => {
  assert.match(safeName('diagram.PNG'), /\.PNG$/);
  assert.match(safeName('notes.md'), /\.md$/);
});

test('the size cap leaves room for base64 inflation under the 8MB body limit', () => {
  // base64 grows a payload by 4/3; the cap must stay under the server's 8MB body limit or the
  // request is rejected before the route can explain why.
  assert.ok(MAX_BYTES * (4 / 3) < 8 * 1024 * 1024, 'a permitted file must fit inside the body limit');
});
