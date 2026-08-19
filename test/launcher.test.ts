import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The pinnable launcher.
 *
 * Three scripts: `launch.mjs` starts the dev server and opens a browser, `make-icon.mjs` builds an `.ico` for the
 * shortcut, and `make-shortcut.mjs` writes the platform launcher. Verified end to end on Windows by launching the
 * generated `.lnk` the way Explorer does — both ports came up and the browser opened.
 *
 * Two real bugs are pinned here, both of which only appeared by running the thing rather than reading it.
 */
const launch = readFileSync(join('scripts', 'launch.mjs'), 'utf8');
const shortcut = readFileSync(join('scripts', 'make-shortcut.mjs'), 'utf8');
const icon = readFileSync(join('scripts', 'make-icon.mjs'), 'utf8');

test('the launcher polls localhost, not 127.0.0.1', () => {
  /*
   * The bug: Vite binds only to `[::1]` here, so polling the IPv4 address returned ECONNREFUSED forever and the
   * launcher gave up after 90 seconds while the server was running perfectly. Measured directly — `curl 127.0.0.1`
   * gave nothing, `curl localhost` gave 200, and netstat showed a single `[::1]:5173` listener.
   */
  assert.match(launch, /const CLIENT_URL = 'http:\/\/localhost:5173'/);
  assert.ok(!/CLIENT_URL = 'http:\/\/127\.0\.0\.1/.test(launch));
});

test('clicking twice opens a tab instead of fighting over the port', () => {
  assert.match(launch, /Flight Deck is already running/);
  // The check comes before anything is spawned.
  assert.ok(launch.indexOf('if (await isUp())') < launch.indexOf("spawn('npm'"));
});

test('the browser is opened only once the client answers', () => {
  // Opening it immediately shows a connection error for the second or two Vite takes to bind, which reads as broken.
  assert.match(launch, /waitUntilReady\(\)\.then\(\(ready\) => \{/);
  assert.match(launch, /if \(ready\) \{\s*\n\s*openBrowser\(CLIENT_URL\)/);
});

test('every poll has a timeout, so a half-open socket cannot hang the wait', () => {
  assert.match(launch, /AbortSignal\.timeout\(\d+\)/);
});

test('npm is spawned through a shell on Windows only', () => {
  // `npm` is a `.cmd` shim, which CreateProcess cannot execute directly — the same reason server/cli.ts resolves the
  // claude binary the way it does.
  assert.match(launch, /shell: process\.platform === 'win32'/);
});

test('closing the window stops the server', () => {
  assert.match(launch, /child\.kill\(\)/);
  assert.match(launch, /for \(const signal of \['SIGINT', 'SIGTERM'\]\)/);
});

test('the launcher needs no dependencies', () => {
  // A launcher that requires `npm install` to have worked is no use when the install is what is broken.
  for (const line of launch.split(/\r?\n/)) {
    if (!line.startsWith('import ')) continue;
    assert.match(line, /from 'node:/, `${line.trim()} is not a built-in`);
  }
});

test('the shortcut argument has one pair of quotes, not two', () => {
  /*
   * The bug: PowerShell single-quoted strings need no escaping for `"`, so the doubled form produced
   * `node ""path""`. cmd passes that through verbatim and node then cannot resolve the module — the shortcut looked
   * perfect when read back with WScript.Shell and failed the moment it ran.
   */
  assert.match(shortcut, /\$s\.Arguments = '\/k node "\$\{launcher\}"'/);
  assert.ok(!shortcut.includes('""${launcher}""'));
});

test('the window stays open, because it is the log', () => {
  // `/k` not `/c`: the console is where the server prints, and closing it is how the server is stopped.
  assert.match(shortcut, /'\/k node/);
});

test('the desktop location is asked of the system on Windows', () => {
  // `~/Desktop` is a guess and it was wrong on the machine this was written on: the desktop is redirected to
  // `~/OneDrive/Desktop`, so the first shortcut landed in the home directory.
  assert.match(shortcut, /\[Environment\]::GetFolderPath\('Desktop'\)/);
  // With a fallback, since a shortcut's location is not worth failing over.
  assert.match(shortcut, /const guess = join\(homedir\(\), 'Desktop'\)/);
});

test('all three platforms get a launcher', () => {
  assert.match(shortcut, /function windows\(\)/);
  assert.match(shortcut, /function macos\(\)/);
  assert.match(shortcut, /function linux\(\)/);
  assert.match(shortcut, /\.lnk/);
  assert.match(shortcut, /\.command/);
  assert.match(shortcut, /\.desktop/);
});

test('generated launchers are not committed', () => {
  // They embed absolute paths for one machine, which is exactly what this project forbids everywhere else.
  const ignored = readFileSync('.gitignore', 'utf8');
  for (const pattern of ['*.lnk', '*.command', '*.desktop']) {
    assert.ok(ignored.includes(pattern), `${pattern} must be ignored`);
  }
});

test('the icon is a valid multi-size ICO wrapping the committed PNGs', () => {
  // Since Vista an ICO entry may hold PNG bytes verbatim, so nothing is re-encoded and the icon is exactly the
  // artwork already in the repository.
  assert.match(icon, /may hold PNG bytes verbatim/);

  const path = join('public', 'favicon.ico');
  const data = readFileSync(path);
  assert.equal(data.readUInt16LE(0), 0, 'reserved');
  assert.equal(data.readUInt16LE(2), 1, 'type 1 = icon');

  const count = data.readUInt16LE(4);
  assert.ok(count >= 2, `expected several sizes, found ${count}`);

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let index = 0; index < count; index++) {
    const at = 6 + index * 16;
    const size = data.readUInt32LE(at + 8);
    const offset = data.readUInt32LE(at + 12);
    assert.ok(offset + size <= data.length, 'entry points inside the file');
    assert.ok(data.subarray(offset, offset + 8).equals(PNG), 'each entry is a PNG');
  }
  assert.ok(statSync(path).size > 10_000);
});

test('npm exposes the three commands', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
  assert.equal(scripts.launch, 'node scripts/launch.mjs');
  assert.equal(scripts.shortcut, 'node scripts/make-shortcut.mjs');
  assert.equal(scripts.icon, 'node scripts/make-icon.mjs');
});

test('the icon builder runs and is idempotent', () => {
  // Cheap enough to actually execute, which is worth more than asserting on its source.
  const before = readFileSync(join('public', 'favicon.ico'));
  execFileSync(process.execPath, [join('scripts', 'make-icon.mjs')], { stdio: 'pipe' });
  assert.ok(readFileSync(join('public', 'favicon.ico')).equals(before), 'rebuilding changes nothing');
});
