/**
 * Spotting a device-code login in terminal output.
 *
 * WHY THIS EXISTS: `gh auth login` prints a one-time code and waits. Copying it out of a terminal is the one
 * thing a terminal makes hard — `Ctrl+C` is SIGINT, so the obvious attempt kills the very flow you are trying
 * to complete. Reported from use, on exactly that: the code was on screen and unreachable.
 *
 * So the code is lifted out of the stream and offered as a button. Nothing about this is gh-specific: Azure,
 * Docker, Google and every other device-code flow prints the same shape, and this reads any of them.
 *
 * Pure, and separate from the terminal, because the failure mode is silent — a pattern that stops matching
 * leaves a banner that never appears, which looks like a feature that was never built.
 */

/**
 * Codes come as two groups of four: `8FA9-3FF2`. Some flows use one longer group, so both are read.
 *
 * Global, because the LAST one in the buffer is the live one: retry a failed login and the tail holds two
 * codes, and offering the dead one is worse than offering nothing. The first version took the first match —
 * caught by the first review this feature ever ran, against its own diff.
 */
const CODE = /one[- ]time code[:\s]+([A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})?)/gi;

/**
 * The URL to visit. Captured from the same output rather than hardcoded, so this is not gh-only — and a flow
 * that names an enterprise host sends you to that host rather than to github.com.
 */
const URL_NEARBY = /(https?:\/\/[^\s'"]+)/;

/**
 * ANSI escape sequences, which the code is wrapped in.
 *
 * gh prints the code bold and the URL coloured, so a match against raw PTY output finds `8FA9-` and stops at
 * an escape byte. Stripping first is not optional.
 *
 * Built from a code point because a literal ESC in a source file is invisible and the first tool to normalise
 * the file eats it — the same reason `ENTER` is written this way in useTerminal.
 */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

export interface DeviceCode {
  code: string;
  /** Where to enter it, when the output said. */
  url: string | null;
}

/**
 * Read a device code out of recent terminal output, or null.
 *
 * `text` is expected to be a rolling tail rather than the whole session: the point is to notice the prompt that
 * is on screen now, and an old code found halfway up a scrollback is worse than none.
 */
export function detectDeviceCode(text: string): DeviceCode | null {
  const plain = text.replace(ANSI, '');

  // The last match, not the first: see CODE. `lastIndex` is reset by starting a fresh search each call.
  CODE.lastIndex = 0;
  let code: RegExpExecArray | null = null;
  for (let match = CODE.exec(plain); match !== null; match = CODE.exec(plain)) code = match;
  if (!code?.[1]) return null;

  // Only look for the URL after the code, so an unrelated link earlier in the output is not offered as the
  // place to enter it.
  const after = plain.slice(code.index + code[0].length);
  const url = URL_NEARBY.exec(after)?.[1] ?? null;
  return { code: code[1].toUpperCase(), url: url === null ? null : trimPunctuation(url) };
}

/** A URL at the end of a sentence arrives with the sentence attached. */
function trimPunctuation(url: string): string {
  return url.replace(/[.,;:)\]]+$/, '');
}
