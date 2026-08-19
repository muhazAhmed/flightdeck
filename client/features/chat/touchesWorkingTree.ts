/**
 * Which tools can change files on disk.
 *
 * Used to refresh the Changes panel *during* a run rather than only when it ends: watching the file
 * list react as the agent works is most of the reason the two panels sit side by side.
 *
 * Pure and separate from the stream hook so it can be tested directly — the failure mode is silent
 * (a missing name means the panel just looks stale, with nothing in the console to say why).
 */
const WRITERS = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  // The shell tool is named per platform, and the name is NOT `Bash` everywhere: a real session
  // handshake on Windows advertises `PowerShell` and no `Bash` at all. Both belong here — a shell can
  // do anything (`npm install`, `rm`, a generator script), so assume it did.
  'Bash',
  'PowerShell',
  // A subagent edits files itself; only its parent Task call is visible in this stream.
  'Task'
]);

/**
 * `true` when a completed tool call may have changed the working tree.
 *
 * Read-only tools (Read, Glob, Grep, WebFetch, TodoWrite) are excluded — a refresh per Read during a
 * twenty-file exploration is pure noise. `Skill` is excluded too: it loads instructions, and the real
 * writes that follow arrive as their own Edit calls.
 *
 * **Unknown names, including MCP tools, count as read-only.** An MCP server certainly *can* write
 * files, but guessing from a name is worse than the alternative: the run finishing always triggers a
 * refresh, so an unrecognised writer costs a delayed update, never a missed one.
 */
export function touchesWorkingTree(toolName: string): boolean {
  return WRITERS.has(toolName);
}
