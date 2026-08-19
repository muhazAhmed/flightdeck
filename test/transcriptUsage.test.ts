import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summariseTranscript } from '../server/transcriptUsage.ts';

/**
 * Usage read out of Claude Code's transcripts.
 *
 * This exists because `usage.jsonl` only covers runs Flight Deck spawned: a long conversation held in a
 * terminal spends the same quota against the same repository and showed up nowhere, which reads as a broken
 * page rather than an incomplete one.
 *
 * The shapes here are taken from a real transcript on this machine — assistant entries carrying
 * `message.usage` in snake_case, and **no `result` record anywhere in the file**, which is why cost is
 * absent by design rather than by omission.
 */
function write(lines: unknown[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-transcript-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf8');
  return { dir, path };
}

function assistant(overrides: Record<string, unknown> = {}, usage: Record<string, number> = {}) {
  return {
    type: 'assistant',
    timestamp: '2026-08-19T10:00:00.000Z',
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2,
        output_tokens: 100,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 1_000,
        ...usage
      },
      ...overrides
    }
  };
}

test('tokens are summed across assistant entries', () => {
  const { dir, path } = write([
    assistant(),
    assistant({}, { output_tokens: 40, cache_read_input_tokens: 10_000 }),
    { type: 'user', message: { content: 'hello' } }
  ]);
  try {
    const session = summariseTranscript(path, 'abc');
    assert.equal(session?.messages, 2);
    assert.equal(session?.outputTokens, 140);
    assert.equal(session?.cacheReadTokens, 60_000);
    assert.equal(session?.inputTokens, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the model reported is the one that did most of the work', () => {
  const { dir, path } = write([
    assistant({ model: 'claude-haiku-4-5' }),
    assistant({ model: 'claude-opus-5' }),
    assistant({ model: 'claude-opus-5' })
  ]);
  try {
    // A session that switched models mid-way is still best described by the one that wrote most of it.
    assert.equal(summariseTranscript(path, 'abc')?.model, 'claude-opus-5');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first and last timestamps bound the session', () => {
  const { dir, path } = write([
    { ...assistant(), timestamp: '2026-08-19T09:00:00.000Z' },
    { ...assistant(), timestamp: '2026-08-19T11:30:00.000Z' },
    { ...assistant(), timestamp: '2026-08-19T10:00:00.000Z' }
  ]);
  try {
    const session = summariseTranscript(path, 'abc');
    assert.equal(session?.firstAt, '2026-08-19T09:00:00.000Z');
    assert.equal(session?.lastAt, '2026-08-19T11:30:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a half-written final line is skipped, not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-transcript-'));
  const path = join(dir, 'session.jsonl');
  try {
    // A live transcript is being appended to while it is read; the last line is routinely partial.
    writeFileSync(path, `${JSON.stringify(assistant())}\n{"type":"assistant","message":{"usage":{"outp`, 'utf8');
    assert.equal(summariseTranscript(path, 'abc')?.messages, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a transcript with no assistant usage is not reported at all', () => {
  const { dir, path } = write([
    { type: 'user', message: { content: 'hi' } },
    { type: 'system', subtype: 'init' }
  ]);
  try {
    // An empty or aborted session is noise on a usage page, not information.
    assert.equal(summariseTranscript(path, 'abc'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file reports nothing rather than throwing', () => {
  assert.equal(summariseTranscript(join(tmpdir(), 'flightdeck-no-such-transcript.jsonl'), 'abc'), null);
});

test('entries are matched on snake_case, which is what a transcript uses', () => {
  // `modelUsage` in the CLI's result record is camelCase; `message.usage` in a transcript is snake_case.
  // Reading the wrong casing here produces a confident zero rather than an error.
  const { dir, path } = write([
    {
      type: 'assistant',
      timestamp: '2026-08-19T10:00:00.000Z',
      message: { model: 'claude-opus-5', usage: { outputTokens: 999, cacheReadInputTokens: 999 } }
    }
  ]);
  try {
    const session = summariseTranscript(path, 'abc');
    // The entry counts as a message, but camelCase fields contribute nothing — proving which casing wins.
    assert.equal(session?.messages, 1);
    assert.equal(session?.outputTokens, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('there is no cost field, because a transcript has no cost in it', () => {
  const { dir, path } = write([assistant()]);
  try {
    const session = summariseTranscript(path, 'abc');
    // `total_cost_usd` belongs to the `result` record, which `-p` writes to stdout and never to the file.
    // Pricing tokens here would turn the number people act on into a guess.
    assert.ok(session && !('costUsd' in session));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
