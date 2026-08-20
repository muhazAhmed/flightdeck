import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectDeviceCode } from '../client/features/terminal/deviceCode.ts';

/**
 * Lifting a one-time code out of terminal output.
 *
 * THE PROBLEM THIS SOLVES, reported from use: `gh auth login` prints a code and waits, and a terminal is the
 * one place you cannot casually copy from — `Ctrl+C` is SIGINT, so reaching for the code kills the login. The
 * code was on screen and unreachable.
 *
 * The fixtures below are the real thing: gh's own words, with the escape sequences it really emits.
 */
const ESC = String.fromCharCode(27);
const BOLD = `${ESC}[0;1;39m`;
const CYAN = `${ESC}[0;36m`;
const OFF = `${ESC}[0m`;

/** What was actually on screen when this was reported, colours included. */
const GH_OUTPUT = [
  `? How would you like to authenticate GitHub CLI? ${CYAN}Login with a web browser${OFF}`,
  '',
  `! First copy your one-time code: ${BOLD}8FA9-3FF2${OFF}`,
  `Press Enter to open ${CYAN}https://github.com/login/device${OFF} in your browser...`
].join('\r\n');

test('the code and the URL are read out of real gh output', () => {
  const found = detectDeviceCode(GH_OUTPUT);
  assert.equal(found?.code, '8FA9-3FF2');
  assert.equal(found?.url, 'https://github.com/login/device');
});

test('escape sequences do not truncate the code', () => {
  /*
   * The failure this prevents: gh prints the code bold, so a match against raw PTY bytes finds `8FA9-` and
   * stops at the escape byte that follows. Stripping ANSI first is not optional.
   */
  const found = detectDeviceCode(`one-time code: ${BOLD}ABCD-1234${OFF}`);
  assert.equal(found?.code, 'ABCD-1234');

  // And the phrase is required, not just `code:` — otherwise `npm error code ELIFECYCLE` raises a banner.
  assert.equal(detectDeviceCode(`code: ${BOLD}ABCD-1234${OFF}`), null);
});

test('the URL is taken from after the code, not from anything earlier', () => {
  // A link printed earlier in the session is not where you enter this code.
  const output = [
    'Downloading https://example.com/some/release.msi',
    'First copy your one-time code: WXYZ-7890',
    'Then open https://github.com/login/device'
  ].join('\n');
  assert.equal(detectDeviceCode(output)?.url, 'https://github.com/login/device');
});

test('a URL at the end of a sentence loses the sentence', () => {
  const found = detectDeviceCode('one-time code: AAAA-BBBB\nOpen https://github.com/login/device.');
  assert.equal(found?.url, 'https://github.com/login/device');
});

test('a code with no URL is still worth offering', () => {
  // Some flows print the code and tell you where to go in a previous line, or not at all.
  const found = detectDeviceCode('Your one-time code: QQQQ-2222');
  assert.equal(found?.code, 'QQQQ-2222');
  assert.equal(found?.url, null);
});

test('the code is read regardless of case, and normalised', () => {
  assert.equal(detectDeviceCode('One-Time Code: abcd-ef12')?.code, 'ABCD-EF12');
  // Azure and others use one longer group rather than two.
  assert.equal(detectDeviceCode('one-time code: A1B2C3D4')?.code, 'A1B2C3D4');
});

test('ordinary output produces nothing', () => {
  // A banner that appears while a build is running would be worse than no banner at all.
  for (const line of [
    'npm error code ELIFECYCLE',
    'error TS2304: Cannot find name Button',
    'git commit -m "one time fix"',
    'Compiled successfully in 4.2s',
    ''
  ]) {
    assert.equal(detectDeviceCode(line), null, line);
  }
});

test('a code split across two chunks is found once they are joined', () => {
  /*
   * A PTY delivers output in arbitrary chunks — a code can and does arrive across a boundary. The hook keeps a
   * rolling tail and matches against that, which is what makes this work; matching per chunk would not.
   */
  const first = 'First copy your one-time co';
  const second = 'de: 5MP4-QQ21\r\n';
  assert.equal(detectDeviceCode(first), null);
  assert.equal(detectDeviceCode(second), null, 'the tail half alone is not a match either');
  assert.equal(detectDeviceCode(first + second)?.code, '5MP4-QQ21');
});

test('only the most recent code is read', () => {
  /*
   * Retry a failed login and there are two codes in the buffer; the live one is the last. This test's NAME
   * always said that and its assertion checked the opposite — the first review this feature ever ran caught
   * the matcher taking the first match, and the test that should have failed was agreeing with it.
   */
  const output = 'one-time code: OLD1-OLD1\n...\nfirst copy your one-time code: NEW2-NEW2\n';
  assert.equal(detectDeviceCode(output)?.code, 'NEW2-NEW2');
  // And the buffer is a tail rather than the whole session, so an ancient code ages out of it entirely.
  assert.match(readFileSync('client/features/terminal/useTerminal.ts', 'utf8'), /slice\(-TAIL_BYTES\)/);
});

test('scanning never re-renders per chunk', () => {
  const source = readFileSync('client/features/terminal/useTerminal.ts', 'utf8');
  /*
   * The standing rule: no `setState` per streamed chunk, or a busy build log re-renders the app thousands of
   * times. The tail lives in a ref, the scan sits behind a cheap prefilter, and React only hears about a code
   * that differs from the one it already has — once per login.
   */
  assert.match(source, /tailRef\.current = \(tailRef\.current \+ message\.data\)/);
  /*
   * The prefilter also has to let a refinement through: `Press Enter to open <url>` contains no "code", so
   * filtering on the chunk alone meant the URL never reached the matcher and the fix for the missing link was
   * dead code. Caught by the first review this feature ever ran.
   */
  assert.match(source, /if \(\/code\/i\.test\(message\.data\) \|\| deviceCodeRef\.current !== null\)/);
  // Replayed scrollback is rendered but never read — an old code must not raise a banner on reattach.
  assert.match(source, /if \(message\.replay\) break;/);
  assert.match(source, /found\.code !== known\?\.code/);
  // Only a genuinely better answer reaches React: a new code, or the URL that arrived after one.
  assert.match(source, /if \(found && better\)/);
});

test('clearing the terminal clears the code with it', () => {
  const source = readFileSync('client/features/terminal/useTerminal.ts', 'utf8');
  // Otherwise a banner outlives the prompt it belongs to, pointing at a code the CLI has forgotten.
  const clear = source.slice(source.indexOf('const clear = useCallback'));
  assert.match(clear, /tailRef\.current = ''/);
  assert.match(clear, /setDeviceCode\(null\)/);
});

test('the banner copies on a real press and presses Enter for you', () => {
  const drawer = readFileSync('client/features/terminal/TerminalDrawer.tsx', 'utf8');
  // A clipboard write from the pattern match would have no user gesture behind it, and browsers refuse those.
  assert.match(drawer, /navigator\.clipboard\.writeText\(code\)/);
  // Both outcomes are reported honestly: a toast claiming "copied" when nothing was is worse than no toast.
  assert.match(drawer, /Could not reach the clipboard/);
  // Enter is what the prompt is waiting for; the CLI then opens the browser through the OS handler.
  assert.match(drawer, /send\(String\.fromCharCode\(13\)\)/);
  assert.match(drawer, /Copy and open sign-in/);
  // And the code stays readable, for typing into a phone.
  assert.match(drawer, /select-all/);
});

test('the URL that arrives in a later chunk is picked up', () => {
  /*
   * REPORTED FROM USE: the banner appeared with no link. gh prints the code and the "Press Enter to open <url>"
   * line in separate PTY chunks, so the first match has no URL — and the hook only replaced its state when the
   * CODE changed, so the first answer won and the link never appeared.
   */
  const withCode = 'First copy your one-time code: 88C9-00C4\r\n';
  const withUrl = 'Press Enter to open https://github.com/login/device in your browser...\r\n';
  assert.equal(detectDeviceCode(withCode)?.url, null, 'the first chunk really has no URL');
  assert.equal(detectDeviceCode(withCode + withUrl)?.url, 'https://github.com/login/device');

  const source = readFileSync('client/features/terminal/useTerminal.ts', 'utf8');
  // Same code, newly-found URL, counts as better and replaces what React has.
  assert.match(source, /found\.url !== null && !known\?\.url/);
});
