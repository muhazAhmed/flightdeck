import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/**
 * Portability, enforced rather than trusted.
 *
 * CLAUDE.md rule 8 says every machine-specific value lives in `server/platform.ts`, and a path literal anywhere
 * else is a bug. That was a convention people had to remember; this makes it a failing test. The motivation was
 * concrete: a reader asked why the repository mentioned the author's drive and username at all, and whether that
 * would stop anyone else from running the tool.
 *
 * It would not have — every occurrence was a comment, a fixture or the project's own URL, and nothing resolved a
 * real path at runtime. But "nothing is broken today" is not "nothing can break tomorrow", which is what a test
 * is for.
 *
 * Written to be precise rather than loud. A guard that fails on legitimate cases gets deleted, so the
 * exceptions are named and justified instead of the thresholds being loosened.
 */
const SHIPPED = ['server', 'client', 'shared'];
const ALL = [...SHIPPED, 'test'];
const CODE = new Set(['.ts', '.tsx', '.css']);

/** Where a machine-specific path is not merely allowed but the entire point of the file. */
const PLATFORM = join('server', 'platform.ts');

/** This file names the very strings it searches for, so it cannot scan itself. */
const SELF = join('test', 'portability.test.ts');

/**
 * The project's own repository.
 *
 * It contains the author's account name, and it should: a fork checks its own git remote for updates, so this URL
 * is only ever a link for a human to click. Stripped before the username scan rather than exempting the file,
 * which would let a real path hide in it.
 */
const OWN_REPO = 'https://github.com/muhazAhmed/flightdeck';

const ALLOWED_URL_PREFIXES = [
  OWN_REPO,
  'https://claude.com',
  'https://fonts.',
  'http://localhost',
  'http://127.0.0.1',
  'https://nodejs.org',
  'https://rolldown.rs',
  // A documentation example in a markdown-rendering fixture; example.com exists for exactly this.
  'https://example.com',
  // The GitHub CLI's own install instructions, shown when we cannot name a command for this machine. A link
  // a human clicks, not a host this app talks to.
  'https://github.com/cli/cli',
  // GitHub's device-login endpoint, appearing in a fixture of gh's real output. Read out of the terminal at
  // runtime rather than assumed — an enterprise host prints its own, and the banner follows whatever it says.
  'https://github.com/login/device',
  // The token-creation page, with the scopes gh asks for prefilled. A link a human clicks.
  'https://github.com/settings/tokens/new',
  /*
   * A URL built from a variable, which by definition does not hardcode a host — the host is a named constant
   * the reader can see and change. Used by the remote-parsing fixtures, which have to contain clone URLs to be
   * worth anything.
   *
   * This rule caught those fixtures, then caught the comment that explained them for naming a scheme, and it
   * was right both times: the answer was to stop writing the host, not to widen the rule to a real one.
   */
  'https://${',
  // The same, with credentials in front — which is how a cloned remote often looks.
  'https://user@${',
  'https://user:token@${'
];

function sourceFiles(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (CODE.has(extname(entry.name))) {
        found.push(path);
      }
    }
  };
  for (const root of roots) walk(root);
  return found.filter((file) => relative('.', file) !== SELF);
}

const everything = sourceFiles(ALL);
const shipped = sourceFiles(SHIPPED);

/** Text with the allowed URLs removed, so a scan cannot be fooled by one and cannot trip over one. */
function withoutAllowedUrls(text: string): string {
  let out = text;
  for (const prefix of ALLOWED_URL_PREFIXES) out = out.split(prefix).join('');
  return out;
}

test('there are source files to check, so a passing run means something', () => {
  assert.ok(everything.length > 40, `expected the whole tree, found ${everything.length} files`);
  assert.ok(shipped.length > 30, `expected the shipped tree, found ${shipped.length} files`);
});

test('no source file names the author outside the repository link', () => {
  // A username is the giveaway that a value was copied off a machine rather than derived on one.
  const offenders = everything.filter((file) => /muhaz/i.test(withoutAllowedUrls(readFileSync(file, 'utf8'))));
  assert.deepEqual(offenders, [], 'these files name a specific user');
});

test('no shipped file writes an absolute home-directory path', () => {
  // Tests are excluded deliberately: a fixture needs a path to assert on, and the rule that keeps those honest is
  // the one above — a generic `/home/dev/app` is fine, the author's own directory is not.
  const WINDOWS_HOME = /[A-Za-z]:[\\/]+(?:Users|home)[\\/]+/i;
  const POSIX_HOME = /\/(?:home|Users)\/[a-z][a-z0-9._-]*\//i;

  const offenders = shipped.filter((file) => {
    if (relative('.', file) === PLATFORM) return false;
    const text = readFileSync(file, 'utf8');
    return WINDOWS_HOME.test(text) || POSIX_HOME.test(text);
  });
  assert.deepEqual(offenders, [], 'a home-directory path belongs in platform.ts, derived from homedir()');
});

test('every machine-specific location is derived, not written down', () => {
  const platform = readFileSync(PLATFORM, 'utf8');
  // homedir() for the user's data; this module's own URL for the install. Both computed at runtime.
  assert.match(platform, /import \{ homedir, platform \} from 'node:os'/);
  assert.match(platform, /join\(homedir\(\)/);
  assert.match(platform, /fileURLToPath\(new URL\('\.\.', import\.meta\.url\)\)/);

  // Not one absolute path is written out here: every location is composed from homedir() or this file's URL.
  const literals = platform.match(/'[A-Za-z]:\\[^']*'/g) ?? [];
  assert.deepEqual(literals, [], 'platform.ts composes paths; it does not contain them');
});

test('the only absolute literals in shipped code are OS constants, in the shell module', () => {
  /*
   * `C:\Windows` and `/bin/sh` are facts about an operating system, not about a machine — unlike a home
   * directory, they are the same for every user of that OS, and each is a documented fallback for an unset
   * environment variable (%SystemRoot%, $SHELL).
   *
   * They are confined to `server/shells.ts`, which exists to know the platform's shell layout. This test names
   * the exception explicitly so that a path appearing anywhere else fails, instead of the rule quietly eroding.
   */
  const ABSOLUTE = /'[A-Za-z]:\\[^']*'|'\/(?:usr|bin|etc|opt)[^']*'/g;
  const found = new Map<string, string[]>();
  for (const file of shipped) {
    const hits = readFileSync(file, 'utf8').match(ABSOLUTE) ?? [];
    if (hits.length > 0) found.set(relative('.', file), [...new Set(hits)].sort());
  }
  assert.deepEqual([...found.keys()], [join('server', 'shells.ts')], 'absolute literals outside the shell module');

  const literals = found.get(join('server', 'shells.ts')) ?? [];
  for (const literal of literals) {
    // Four backslashes: the literal is being matched as it appears in the source, where it is escaped.
    const isOsConstant =
      /^'[A-Za-z]:\\\\(Windows|Program Files)/.test(literal) || /^'\/(usr|bin)\//.test(literal);
    assert.ok(isOsConstant, `${literal} is not an OS constant`);
    assert.ok(!/Users|home/i.test(literal), `${literal} looks like a home directory`);
  }
});

test('nothing assumes a projects directory', () => {
  // There is deliberately no default projects root: guessing one would be wrong for everyone but the author, and
  // a wrong guess in a file picker is worse than an obvious starting point.
  const folder = ['C', 'Studio'].join('');
  const offenders = everything.filter((file) => readFileSync(file, 'utf8').includes(folder));
  assert.deepEqual(offenders, [], 'these files name a specific projects folder');
});

test('the captured sample carries no real paths, plugins or client names', () => {
  // It is a real run, so it arrived full of them — including client project names. Sanitised in place with the
  // record shapes asserted identical before and after, since the tests that read it care about shapes.
  const path = join('docs', 'stream-sample.jsonl');
  const sample = readFileSync(path, 'utf8');
  for (const term of ['muhaz', ['C', 'Studio'].join(''), 'com8', 'mcpmarket', 'threejs']) {
    assert.ok(!sample.includes(term), `the sample still contains "${term}"`);
  }
  // And it is still a usable capture rather than an emptied file.
  assert.ok(sample.includes('"type":"result"'), 'the sample must still hold a result record');
  assert.ok(statSync(path).size > 20_000, 'the sample must still be a full run');
});

test('the only hardcoded URLs are the ones a human clicks', () => {
  // A fork's update check reads its own git remote, so no shipped file needs to know where this one lives.
  for (const file of everything) {
    const text = readFileSync(file, 'utf8');
    for (const url of text.match(/https?:\/\/[^\s'"`)]+/g) ?? []) {
      const ok = ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
      assert.ok(ok, `${file} hardcodes ${url}`);
    }
  }
});

/**
 * Names that leaked once and must not come back.
 *
 * A generic rule cannot know a client's name, so this is a regression list rather than a pattern: each entry was
 * found in this repository — in a path, a doc example, a captured transcript, or as placeholder text in the git
 * identity fields, which is where a real client identity was sitting. Assembled from fragments so this file does
 * not itself contain them.
 */
test('no client or employer name appears anywhere in the source', () => {
  const terms = [
    ['C', 'Studio'].join(''),
    ['com', '8'].join(''),
    ['Com8', '-Reality'].join(''),
    ['mcp', 'market'].join('')
  ];
  const offenders: string[] = [];
  for (const file of everything) {
    const text = readFileSync(file, 'utf8');
    for (const term of terms) {
      if (text.toLowerCase().includes(term.toLowerCase())) offenders.push(`${relative('.', file)} (${term})`);
    }
  }
  assert.deepEqual(offenders, [], 'a client name is in the source');
});
