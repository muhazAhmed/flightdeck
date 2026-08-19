/**
 * Translation of the `claude` CLI's `stream-json` output into the small event set the
 * browser consumes (`UiEvent`). Pure functions only — no processes, no I/O — so this
 * can be tested against the real captured run in `docs/stream-sample.jsonl`.
 *
 * WHY THE TRANSLATION LIVES SERVER-SIDE: the CLI emits raw Anthropic streaming events
 * wrapped in its own envelope, and that shape belongs to a tool we do not control. If
 * the browser consumed it directly, every CLI change would ripple through React
 * components. Here, it touches one file.
 *
 * Event shapes verified against Claude Code 2.1.233 — see API.md §1.
 */
import type { RunUsage, UiEvent } from '@shared/types';

/** Accumulates stdout chunks and yields whole lines. A JSON object is never parsed
 *  before its terminating newline arrives — a chunk boundary can land mid-object. */
export class LineBuffer {
  private buf = '';

  push(chunk: string): string[] {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    // The last element is either '' (chunk ended on a newline) or a partial line.
    this.buf = lines.pop() ?? '';
    return lines.filter((l) => l.trim().length > 0);
  }

  /** Whatever is left when the process exits without a trailing newline. */
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}

/** A tool_result's `content` is a string in the simple case, but the API also allows an
 *  array of content blocks. Flatten to text either way rather than rendering `[object
 *  Object]` in a card. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) return String((block as { text: unknown }).text);
        return JSON.stringify(block);
      })
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Tokens and model from a `result` record.
 *
 * TWO TRAPS, both verified against a real run:
 *
 *  - There is **no top-level `model` field**. The model is a KEY of `modelUsage`
 *    (`"claude-opus-5[1m]"`), and that key carries a context-window suffix. `canonicalModel` inside
 *    the entry is the id without it, so it is preferred when present.
 *  - Token counts live under `usage` in **snake_case** (`cache_read_input_tokens`), while the same
 *    numbers appear under `modelUsage` in camelCase. Reading the wrong casing yields a confident zero.
 */
function readUsage(record: Record<string, unknown>): RunUsage | null {
  const usage = isRecord(record.usage) ? record.usage : null;
  const models = isRecord(record.modelUsage) ? record.modelUsage : null;

  const key = models ? Object.keys(models)[0] : undefined;
  const entry = key && isRecord(models?.[key]) ? (models[key] as Record<string, unknown>) : null;
  const model = typeof entry?.canonicalModel === 'string' ? entry.canonicalModel : (key ?? null);

  if (!usage && !entry) return null;

  return {
    model,
    inputTokens: usage ? count(usage.input_tokens) : count(entry?.inputTokens),
    outputTokens: usage ? count(usage.output_tokens) : count(entry?.outputTokens),
    cacheReadTokens: usage ? count(usage.cache_read_input_tokens) : count(entry?.cacheReadInputTokens),
    cacheCreationTokens: usage
      ? count(usage.cache_creation_input_tokens)
      : count(entry?.cacheCreationInputTokens)
  };
}

/**
 * Translate one parsed `stream-json` record into zero or more UI events.
 *
 * Deliberate omissions:
 *  - `system/status`, `system/hook_*` — internal lifecycle noise, nothing for the user.
 *  - `content_block_start` for tool_use — the tool's arguments are still empty there and
 *    arrive as `input_json_delta` fragments. We emit `tool_start` from the completed
 *    `assistant` message instead, which carries the full parsed input and still lands
 *    before the tool executes.
 */
export function translate(record: unknown): UiEvent[] {
  if (!isRecord(record)) return [];
  const type = record.type;

  if (type === 'system' && record.subtype === 'init') {
    return [
      {
        type: 'session',
        sessionId: String(record.session_id ?? ''),
        model: String(record.model ?? ''),
        cwd: String(record.cwd ?? ''),
        permissionMode: String(record.permissionMode ?? ''),
        tools: Array.isArray(record.tools) ? record.tools.map(String) : []
      }
    ];
  }

  if (type === 'stream_event' && isRecord(record.event)) {
    const ev = record.event;
    if (ev.type === 'content_block_delta' && isRecord(ev.delta)) {
      if (ev.delta.type === 'text_delta') {
        return [{ type: 'text', delta: String(ev.delta.text ?? '') }];
      }
      return [];
    }
    if (ev.type === 'message_stop') {
      return [{ type: 'turn_end', stopReason: null }];
    }
    if (ev.type === 'message_delta' && isRecord(ev.delta) && ev.delta.stop_reason) {
      return [{ type: 'turn_end', stopReason: String(ev.delta.stop_reason) }];
    }
    return [];
  }

  // A completed assistant message: the only place a tool call is fully known.
  if (type === 'assistant' && isRecord(record.message)) {
    const content = record.message.content;
    if (!Array.isArray(content)) return [];
    const out: UiEvent[] = [];
    for (const block of content) {
      if (isRecord(block) && block.type === 'tool_use') {
        out.push({
          type: 'tool_start',
          id: String(block.id ?? ''),
          name: String(block.name ?? 'tool'),
          input: block.input ?? {},
          parentToolUseId: record.parent_tool_use_id ? String(record.parent_tool_use_id) : null
        });
      }
    }
    return out;
  }

  // Tool results come back as a synthetic `user` message.
  if (type === 'user' && isRecord(record.message)) {
    const content = record.message.content;
    if (!Array.isArray(content)) return [];
    const out: UiEvent[] = [];
    for (const block of content) {
      if (isRecord(block) && block.type === 'tool_result') {
        out.push({
          type: 'tool_result',
          id: String(block.tool_use_id ?? ''),
          content: contentToText(block.content),
          isError: block.is_error === true
        });
      }
    }
    return out;
  }

  if (type === 'rate_limit_event' && isRecord(record.rate_limit_info)) {
    const info = record.rate_limit_info;
    return [
      {
        type: 'rate_limit',
        status: String(info.status ?? 'unknown'),
        resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : null,
        rateLimitType: info.rateLimitType ? String(info.rateLimitType) : null
      }
    ];
  }

  if (type === 'result') {
    return [
      {
        type: 'done',
        isError: record.is_error === true,
        result: typeof record.result === 'string' ? record.result : null,
        numTurns: typeof record.num_turns === 'number' ? record.num_turns : null,
        durationMs: typeof record.duration_ms === 'number' ? record.duration_ms : null,
        costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null,
        denials: Array.isArray(record.permission_denials) ? record.permission_denials : [],
        usage: readUsage(record),
        subtype: typeof record.subtype === 'string' ? record.subtype : null,
        apiErrorStatus: typeof record.api_error_status === 'string' ? record.api_error_status : null
      }
    ];
  }

  return [];
}

/** Parse one NDJSON line and translate it. A malformed line is skipped rather than
 *  killing the stream — the CLI can interleave non-JSON output on stdout in edge cases
 *  (a crash trace, a warning), and losing the whole run over it would be worse. */
export function translateLine(line: string): UiEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  return translate(parsed);
}

/**
 * Coalesces consecutive `text` events into one, leaving every other event untouched and
 * in order. Called on a short timer by the SSE writer so a hundred single-character
 * deltas become one wire message. The client batches again into a rAF flush; both
 * layers matter — this one keeps the socket quiet, that one keeps React sane.
 */
export function coalesceText(events: UiEvent[]): UiEvent[] {
  const out: UiEvent[] = [];
  let pending = '';
  const flush = () => {
    if (pending) {
      out.push({ type: 'text', delta: pending });
      pending = '';
    }
  };
  for (const ev of events) {
    if (ev.type === 'text') {
      pending += ev.delta;
      continue;
    }
    flush();
    out.push(ev);
  }
  flush();
  return out;
}
