/**
 * Usage read out of Claude Code's own transcripts.
 *
 * WHY THIS EXISTS. `usage.jsonl` only records runs Flight Deck spawned. A long conversation held in the
 * terminal or an editor spends the same quota against the same repository and appeared nowhere — which
 * reads as "the usage page is broken" rather than "that work happened elsewhere".
 *
 * WHAT IS AND IS NOT IN A TRANSCRIPT. Every assistant entry carries `message.usage` with real token
 * counts and a real model id. There is **no cost** anywhere in the file: `total_cost_usd` is part of the
 * `result` record, which `-p` writes to stdout and never to the transcript. So these sessions report
 * tokens and are deliberately kept out of the cost totals — inventing a price per token would make the
 * one number people might act on a guess.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TranscriptSession } from '@shared/types';
import { transcriptDirFor } from './platform.js';

/**
 * Transcripts are large — the session that prompted this feature is 15 MB — so lines are prefiltered
 * with a substring test before `JSON.parse`. Measured on that file: 42ms to read, 38ms to scan 4219
 * lines. Parsing every line unconditionally is what makes this too slow to do per request.
 */
const USAGE_HINT = '"usage"';

/** Anything past this is not worth reading synchronously on a request. */
const MAX_BYTES = 64 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Summarise one transcript file.
 *
 * Returns null when the file holds no assistant usage at all — an empty or aborted session is noise on a
 * usage page, not information.
 */
export function summariseTranscript(path: string, sessionId: string): TranscriptSession | null {
  let text: string;
  try {
    if (statSync(path).size > MAX_BYTES) return null;
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  let messages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  const models = new Map<string, number>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(USAGE_HINT)) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      // The last line of a live transcript is routinely half-written.
      continue;
    }
    if (!isRecord(record)) continue;
    const message = isRecord(record.message) ? record.message : null;
    const usage = message && isRecord(message.usage) ? message.usage : null;
    if (!usage) continue;

    messages += 1;
    inputTokens += num(usage.input_tokens);
    outputTokens += num(usage.output_tokens);
    cacheReadTokens += num(usage.cache_read_input_tokens);
    cacheCreationTokens += num(usage.cache_creation_input_tokens);

    const model = message && typeof message.model === 'string' ? message.model : 'unknown';
    models.set(model, (models.get(model) ?? 0) + 1);

    const at = typeof record.timestamp === 'string' ? record.timestamp : null;
    if (at && !Number.isNaN(Date.parse(at))) {
      if (!firstAt || Date.parse(at) < Date.parse(firstAt)) firstAt = at;
      if (!lastAt || Date.parse(at) > Date.parse(lastAt)) lastAt = at;
    }
  }

  if (messages === 0) return null;

  // The model that produced most of the messages: a session that switched models mid-way is still best
  // described by the one that did the work.
  const model = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  return {
    sessionId,
    model,
    messages,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    firstAt,
    lastAt: lastAt ?? new Date(statSync(path).mtimeMs).toISOString()
  };
}

/**
 * Every transcript for a project's working directory.
 *
 * Sessions are located by the CLI's own encoding of the cwd, so a session started anywhere — this app, a
 * terminal, an editor — is found as long as it ran in that folder.
 */
export function sessionsForProject(projectPath: string): TranscriptSession[] {
  const dir = transcriptDirFor(projectPath);
  if (!existsSync(dir)) return [];

  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const sessions: TranscriptSession[] = [];
  for (const name of names) {
    const session = summariseTranscript(join(dir, name), name.slice(0, -'.jsonl'.length));
    if (session) sessions.push(session);
  }
  // Newest first: the session you are asking about is nearly always the one you were just in.
  return sessions.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}
