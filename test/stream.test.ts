import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LineBuffer, coalesceText, translate, translateLine } from '../server/stream.ts';
import type { UiEvent } from '../shared/types.ts';

const SAMPLE = fileURLToPath(new URL('../docs/stream-sample.jsonl', import.meta.url));

function eventsFromSample(): UiEvent[] {
  const lines = readFileSync(SAMPLE, 'utf8').trim().split('\n');
  return lines.flatMap((line) => translateLine(line));
}

test('a real captured run translates into the expected event families', () => {
  const events = eventsFromSample();
  const kinds = new Set(events.map((e) => e.type));

  // The sample is a run that read a file, so it must produce a session handshake, a tool
  // call with its result, streamed text, and a terminal summary.
  for (const expected of ['session', 'tool_start', 'tool_result', 'text', 'done']) {
    assert.ok(kinds.has(expected as UiEvent['type']), `missing ${expected} — got ${[...kinds].join(', ')}`);
  }

  // Exactly one terminal event, and it is last: the client uses it to stop the spinner.
  const done = events.filter((e) => e.type === 'done');
  assert.equal(done.length, 1);
  assert.equal(events.at(-1)?.type, 'done');
});

test('every tool_result matches a tool_start, so no card is orphaned', () => {
  const events = eventsFromSample();
  const started = new Set(events.filter((e) => e.type === 'tool_start').map((e) => e.id));
  for (const event of events) {
    if (event.type === 'tool_result') {
      assert.ok(started.has(event.id), `result for unknown tool id ${event.id}`);
    }
  }
});

test('tool calls carry parsed input, not a JSON fragment', () => {
  const [first] = eventsFromSample().filter((e) => e.type === 'tool_start');
  assert.ok(first, 'sample has no tool call');
  // tool_start is emitted from the completed assistant message precisely so `input` is
  // whole; emitting it from content_block_start would give an empty object here.
  assert.equal(typeof first.input, 'object');
  assert.notDeepEqual(first.input, {});
});

test('malformed lines are skipped rather than killing the stream', () => {
  assert.deepEqual(translateLine('not json at all'), []);
  assert.deepEqual(translateLine(''), []);
  assert.deepEqual(translate(null), []);
  assert.deepEqual(translate({ type: 'something_new' }), []);
});

test('LineBuffer only yields whole lines and keeps the remainder', () => {
  const buffer = new LineBuffer();
  assert.deepEqual(buffer.push('{"a":1}\n{"b":'), ['{"a":1}']);
  assert.deepEqual(buffer.push('2}\n'), ['{"b":2}']);
  assert.deepEqual(buffer.push('tail without newline'), []);
  assert.deepEqual(buffer.flush(), ['tail without newline']);
});

test('coalesceText merges runs of text and preserves order of everything else', () => {
  const merged = coalesceText([
    { type: 'text', delta: 'he' },
    { type: 'text', delta: 'llo' },
    { type: 'turn_end', stopReason: null },
    { type: 'text', delta: ' world' }
  ]);
  assert.deepEqual(merged, [
    { type: 'text', delta: 'hello' },
    { type: 'turn_end', stopReason: null },
    { type: 'text', delta: ' world' }
  ]);
});
