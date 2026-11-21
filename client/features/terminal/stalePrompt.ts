/**
 * Is the shell sitting at an empty prompt that still names a branch it is no longer on?
 *
 * A prompt is text the shell printed once; switching branch from the Changes panel does not reach it, so it
 * goes on saying `(dev)` until something makes the shell print a new one. The only thing that does is Enter —
 * and Enter typed on the user's behalf is only safe when it cannot run or answer anything. Hence three
 * conditions, all required:
 *
 *   - the old branch name is on the prompt (this line, or the one above — Git Bash prints a two-line prompt),
 *     which is what makes it a prompt worth redrawing rather than a build log or a program's own question;
 *   - the line ends in a prompt sigil, so nothing has been typed after it — a half-written command must never
 *     be submitted;
 *   - the cursor is resting right there, not somewhere a full-screen program left it.
 *
 * When in doubt this answers false: a stale prompt is cosmetic, a stray Enter is not.
 */
export function isStalePrompt(lineAbove: string, cursorLine: string, cursorX: number, oldBranch: string): boolean {
  if (!oldBranch) return false;
  const line = cursorLine.trimEnd();
  if (!/[$#%>❯]$/.test(line)) return false;
  // Prompts end "sigil, space"; allow the bare sigil too for shells that omit the space.
  if (cursorX !== line.length && cursorX !== line.length + 1) return false;
  return line.includes(oldBranch) || lineAbove.includes(oldBranch);
}
