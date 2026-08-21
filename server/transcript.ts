/**
 * History replay: turning Claude Code's own transcript back into UI events.
 *
 * Flight Deck stores no message history (DECISIONS.md) — the CLI already writes a JSONL
 * transcript per session, and a second copy would be a second source of truth that can
 * disagree. Reopening a chat therefore means reading that file and translating it through
 * the same event vocabulary the live stream uses, so one set of components renders both.
 *
 * Layout, verified on disk:
 *
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * where the encoding replaces path separators and the drive colon with dashes:
 * `C:\repos\app` becomes `C--repos-app`. A session directory of the same
 * name may sit alongside the file holding `subagents/*.jsonl`; those are nested runs and
 * are not replayed at top level.
 *
 * Every failure here is "no history", never an error. A missing or reshaped transcript
 * must not stop a chat from opening — it is at worst a chat that starts empty, which is
 * exactly the behaviour before this existed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UiEvent } from '@shared/types';
import { projectsRoot, resolveTranscriptDir } from './platform.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Flatten a message's content to plain text, ignoring non-text blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('');
}

/**
 * The transcript records commands and system reminders as user messages too. Replaying
 * those would show the user words they never typed, which is worse than showing nothing.
 */
function isSyntheticPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return (
    trimmed.startsWith('<command-name>') ||
    trimmed.startsWith('<command-message>') ||
    trimmed.startsWith('<local-command-stdout>') ||
    trimmed.startsWith('<system-reminder>') ||
    trimmed.startsWith('Caveat: The messages below')
  );
}

/**
 * Where a session's transcript is, encoded name first and a scan as the fallback.
 *
 * THE ENCODING IS DERIVED FROM OBSERVATION, not from documentation, and it has already been wrong once: it
 * missed that an underscore in a path becomes a dash, so every project with one in its name replayed as an
 * empty chat — the transcript on disk the whole time, one character away. A session id is unambiguous, so when
 * the computed directory does not hold it, every project directory is checked for the file by name.
 *
 * The scan is cheap (one readdir plus a stat per project directory) and only happens on a miss, so the common
 * case still costs nothing. It returns the encoded path when nothing matches, because a caller wants a path to
 * report as missing rather than a null to handle.
 */
export function transcriptPath(cwd: string, sessionId: string): string {
  return findTranscript(projectsRoot(), resolveTranscriptDir(cwd), `${sessionId}.jsonl`);
}

/**
 * The encoded location if the file is there, else wherever in `root` it actually is.
 *
 * Takes its root as an argument so the scan can be tested against a directory built for the purpose rather
 * than against whatever this machine happens to hold.
 */
export function findTranscript(root: string, encodedDir: string, file: string): string {
  const encoded = join(encodedDir, file);
  if (existsSync(encoded)) return encoded;

  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name, file);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // No projects directory at all: the CLI has never run on this machine, which is not an error.
  }
  // The encoded path, so a caller has something to report as missing rather than a null to handle.
  return encoded;
}

/**
 * Replay one session as UI events, or an empty array when there is nothing to replay.
 *
 * Kept separate from `readTranscript` so the translation is testable without a filesystem.
 */
export function replayLines(lines: string[]): UiEvent[] {
  const events: UiEvent[] = [];

  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;

    // Sidechain entries belong to subagents; they appear in the parent transcript too and
    // replaying them would duplicate work the user saw as a single Task card.
    if (record.isSidechain === true) continue;

    const message = isRecord(record.message) ? record.message : null;
    if (!message) continue;

    if (record.type === 'user') {
      const content = message.content;

      // Tool results arrive as synthetic user messages.
      if (Array.isArray(content)) {
        let sawToolResult = false;
        for (const block of content) {
          if (!isRecord(block) || block.type !== 'tool_result') continue;
          sawToolResult = true;
          events.push({
            type: 'tool_result',
            id: String(block.tool_use_id ?? ''),
            content: typeof block.content === 'string' ? block.content : textOf(block.content),
            isError: block.is_error === true
          });
        }
        if (sawToolResult) continue;
      }

      const text = textOf(content);
      if (!isSyntheticPrompt(text)) events.push({ type: 'prompt', text });
      continue;
    }

    if (record.type === 'assistant') {
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === 'text') {
          const text = String(block.text ?? '');
          if (text) events.push({ type: 'text', delta: text });
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool_start',
            id: String(block.id ?? ''),
            name: String(block.name ?? 'tool'),
            input: block.input ?? {},
            parentToolUseId: null
          });
        }
      }
    }
  }

  return events;
}

/** Read and replay a session's transcript. Returns an empty array when absent. */
export function readTranscript(cwd: string, sessionId: string): UiEvent[] {
  const path = transcriptPath(cwd, sessionId);
  if (!existsSync(path)) return [];
  try {
    return replayLines(readFileSync(path, 'utf8').split('\n'));
  } catch {
    return [];
  }
}
