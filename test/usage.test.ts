import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsageRecord } from '../shared/types.ts';
import { aggregate, aggregateProject, read, RUN_ROW_LIMIT, WINDOW_MS } from '../server/usage.ts';
import { translateLine } from '../server/stream.ts';

/**
 * Usage accounting.
 *
 * Arithmetic is the one thing here that can be quietly wrong: a total that is off by a factor of two
 * renders exactly as convincingly as a correct one. So the aggregation is tested against fixtures, and
 * the token extraction is tested against a real captured `result` record.
 */
const NOW = Date.parse('2026-08-19T12:00:00.000Z');
const HOUR = 3_600_000;

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    at: new Date(NOW - HOUR).toISOString(),
    projectId: 'alpha',
    chatId: 'c1',
    model: 'claude-opus-5',
    numTurns: 3,
    durationMs: 10_000,
    costUsd: 0.5,
    inputTokens: 10,
    outputTokens: 100,
    cacheReadTokens: 70_000,
    cacheCreationTokens: 40_000,
    isError: false,
    denials: 0,
    ...overrides
  };
}

const options = {
  days: 30,
  now: NOW,
  nameOf: (id: string) => id.toUpperCase(),
  windowResetsAt: null,
  rateLimitType: null
};

test('totals add up across runs', () => {
  const report = aggregate([record(), record({ costUsd: 0.25, numTurns: 1 })], options);
  assert.equal(report.totals.runs, 2);
  assert.equal(report.totals.turns, 4);
  assert.equal(report.totals.costUsd, 0.75);
  assert.equal(report.totals.outputTokens, 200);
});

test('cost is rounded, so no table ever shows 0.45736200000000005', () => {
  const report = aggregate([record({ costUsd: 0.45736200000000005 }), record({ costUsd: 0.1 })], options);
  // Floating-point addition of real CLI costs is exactly where this leaks into the UI.
  assert.equal(report.totals.costUsd, 0.5574);
  assert.ok(String(report.totals.costUsd).length < 8);
});

test('projects are ranked by cost, not by run count', () => {
  const report = aggregate(
    [
      record({ projectId: 'cheap', costUsd: 0.01 }),
      record({ projectId: 'cheap', costUsd: 0.01 }),
      record({ projectId: 'cheap', costUsd: 0.01 }),
      record({ projectId: 'expensive', costUsd: 2 })
    ],
    options
  );
  // One Opus refactor outweighs thirty Haiku edits; ordering by runs would bury it.
  assert.deepEqual(report.projects.map((p) => p.projectId), ['expensive', 'cheap']);
  assert.equal(report.projects[0]?.runs, 1);
  assert.equal(report.projects[1]?.runs, 3);
});

test('shares are fractions of cost and sum to one', () => {
  const report = aggregate(
    [record({ projectId: 'a', costUsd: 3 }), record({ projectId: 'b', costUsd: 1 })],
    options
  );
  assert.equal(report.projects[0]?.share, 0.75);
  assert.equal(report.projects[1]?.share, 0.25);
});

test('a period with no cost does not divide by zero', () => {
  const report = aggregate([record({ costUsd: 0 })], options);
  assert.equal(report.projects[0]?.share, 0);
  assert.equal(report.models[0]?.share, 0);
});

test('records outside the period are excluded', () => {
  const old = record({ at: new Date(NOW - 40 * 24 * HOUR).toISOString(), costUsd: 9 });
  const recent = record({ costUsd: 1 });
  assert.equal(aggregate([old, recent], { ...options, days: 30 }).totals.runs, 1);
  // days: 0 means everything ever recorded.
  assert.equal(aggregate([old, recent], { ...options, days: 0 }).totals.runs, 2);
  assert.equal(aggregate([old, recent], { ...options, days: 0 }).since, null);
});

test('a removed project keeps its history, labelled', () => {
  const report = aggregate([record({ projectId: 'ghost' })], {
    ...options,
    nameOf: (id) => (id === 'ghost' ? `${id} (removed)` : id)
  });
  // The money was still spent; dropping the row would make the totals disagree with the rows.
  assert.equal(report.projects[0]?.name, 'ghost (removed)');
});

test('the quota window uses the CLI reset time when one is known', () => {
  const resetsAt = Math.floor((NOW + 2 * HOUR) / 1000);
  // Window = resetsAt - 5h, so a run 2h ago is inside and a run 4h ago is not.
  const inside = record({ at: new Date(NOW - 2 * HOUR).toISOString(), costUsd: 1 });
  const outside = record({ at: new Date(NOW - 4 * HOUR).toISOString(), costUsd: 5 });
  const report = aggregate([inside, outside], { ...options, windowResetsAt: resetsAt });
  assert.equal(report.window.resetsAt, resetsAt);
  assert.equal(report.window.totals.runs, 1);
  assert.equal(report.window.totals.costUsd, 1);
});

test('with no reset time known the window is the last five hours', () => {
  const inside = record({ at: new Date(NOW - 4 * HOUR).toISOString() });
  const outside = record({ at: new Date(NOW - 6 * HOUR).toISOString() });
  const report = aggregate([inside, outside], options);
  assert.equal(report.window.totals.runs, 1);
  assert.equal(Date.parse(report.window.startedAt), NOW - WINDOW_MS);
});

test('the window is independent of the selected period', () => {
  // Looking at 90 days must not widen "this window" to 90 days of quota.
  const inWindow = record({ at: new Date(NOW - HOUR).toISOString() });
  const older = record({ at: new Date(NOW - 20 * 24 * HOUR).toISOString() });
  const report = aggregate([inWindow, older], { ...options, days: 90 });
  assert.equal(report.totals.runs, 2);
  assert.equal(report.window.totals.runs, 1);
});

test('days are local, because "which day did I do that" is a local question', () => {
  const report = aggregate([record()], options);
  const expected = new Date(NOW - HOUR);
  const month = `${expected.getMonth() + 1}`.padStart(2, '0');
  const day = `${expected.getDate()}`.padStart(2, '0');
  assert.equal(report.daily[0]?.day, `${expected.getFullYear()}-${month}-${day}`);
});

test('errors are counted without being excluded from cost', () => {
  const report = aggregate([record({ isError: true, costUsd: 0.4 })], options);
  // A failed run still spent quota.
  assert.equal(report.totals.errors, 1);
  assert.equal(report.totals.costUsd, 0.4);
});

test('a truncated or corrupt line costs one line, not the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-usage-'));
  const path = join(dir, 'usage.jsonl');
  try {
    const good = JSON.stringify(record());
    // The middle line is what a process killed mid-write leaves behind.
    writeFileSync(path, `${good}\n{"at":"2026-08-19T10:00:00.00\n${good}\nnot json at all\n`, 'utf8');
    assert.equal(read(path).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a record without a time or a project is skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-usage-'));
  const path = join(dir, 'usage.jsonl');
  try {
    // Neither can be aggregated on any axis, so keeping them would only skew totals.
    writeFileSync(
      path,
      [
        JSON.stringify({ ...record(), at: 'not a date' }),
        JSON.stringify({ ...record(), projectId: undefined }),
        JSON.stringify(record())
      ].join('\n'),
      'utf8'
    );
    assert.equal(read(path).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing log reads as no usage rather than throwing', () => {
  assert.deepEqual(read(join(tmpdir(), 'flightdeck-no-such-usage-4a1c.jsonl')), []);
});

/**
 * Token extraction, against the captured run in docs/stream-sample.jsonl.
 *
 * Two traps live here, and both produce a confident zero rather than an error: there is no top-level
 * `model` field (it is a KEY of `modelUsage`, with a `[1m]` suffix), and `usage` uses snake_case while
 * `modelUsage` uses camelCase for the same numbers.
 */
test('usage and model come off a real result record', () => {
  const line = readFileSync('docs/stream-sample.jsonl', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.includes('"type":"result"'));
  assert.ok(line, 'the sample must contain a result record');

  const [event] = translateLine(line);
  assert.equal(event?.type, 'done');
  const done = event as Extract<typeof event, { type: 'done' }>;

  assert.ok(done.usage, 'usage must be extracted');
  // Verbatim from the capture: input 6, output 132, cache read 71264, cache creation 41840.
  assert.equal(done.usage?.inputTokens, 6);
  assert.equal(done.usage?.outputTokens, 132);
  assert.equal(done.usage?.cacheReadTokens, 71264);
  assert.equal(done.usage?.cacheCreationTokens, 41840);
  // `canonicalModel`, not the `claude-opus-5[1m]` key.
  assert.equal(done.usage?.model, 'claude-opus-5');
});

test('a result record with no usage block yields null rather than zeros', () => {
  // Zeros would silently enter the totals as a free run.
  const [event] = translateLine(JSON.stringify({ type: 'result', is_error: false, num_turns: 1 }));
  assert.equal((event as { usage?: unknown }).usage, null);
});

/**
 * Per-project detail.
 *
 * Shares `add` and `round` with the cross-project report on purpose: two implementations of the same sum
 * is how a detail page ends up disagreeing with the row that led to it, so these tests check the two
 * against each other rather than only against fixtures.
 */
const detailOptions = {
  projectId: 'alpha',
  days: 30,
  now: NOW,
  name: 'Alpha',
  titleOf: (chatId: string) => (chatId === 'c1' ? 'First chat' : 'Deleted chat')
};

test('detail totals match the row the cross-project table showed', () => {
  const records = [
    record({ projectId: 'alpha', costUsd: 0.3 }),
    record({ projectId: 'alpha', costUsd: 0.2, numTurns: 5 }),
    record({ projectId: 'beta', costUsd: 9 })
  ];
  const row = aggregate(records, options).projects.find((p) => p.projectId === 'alpha');
  const detail = aggregateProject(records, detailOptions);
  assert.equal(detail.totals.runs, row?.runs);
  assert.equal(detail.totals.costUsd, row?.costUsd);
  assert.equal(detail.totals.turns, row?.turns);
});

test('only the project asked for is included', () => {
  const detail = aggregateProject(
    [record({ projectId: 'alpha' }), record({ projectId: 'beta', costUsd: 9 })],
    detailOptions
  );
  assert.equal(detail.totals.runs, 1);
  assert.equal(detail.runs.length, 1);
});

test('runs are listed newest first', () => {
  const detail = aggregateProject(
    [
      record({ at: new Date(NOW - 5 * HOUR).toISOString(), numTurns: 1 }),
      record({ at: new Date(NOW - HOUR).toISOString(), numTurns: 2 }),
      record({ at: new Date(NOW - 3 * HOUR).toISOString(), numTurns: 3 })
    ],
    detailOptions
  );
  // The run you are looking for is almost always the last one.
  assert.deepEqual(detail.runs.map((run) => run.numTurns), [2, 3, 1]);
});

test('a long history is capped and says how much it left out', () => {
  const many = Array.from({ length: RUN_ROW_LIMIT + 17 }, (_unused, index) =>
    record({ at: new Date(NOW - index * 60_000).toISOString() })
  );
  const detail = aggregateProject(many, detailOptions);
  assert.equal(detail.runs.length, RUN_ROW_LIMIT);
  assert.equal(detail.omittedRuns, 17);
  // The totals must still cover everything, or the table and the figures above it disagree.
  assert.equal(detail.totals.runs, RUN_ROW_LIMIT + 17);
});

test('a short history reports nothing omitted', () => {
  assert.equal(aggregateProject([record()], detailOptions).omittedRuns, 0);
});

test('chats are ranked by cost and titled, including deleted ones', () => {
  const detail = aggregateProject(
    [
      record({ chatId: 'c1', costUsd: 0.1 }),
      record({ chatId: 'c2', costUsd: 0.9 }),
      record({ chatId: 'c2', costUsd: 0.2 })
    ],
    detailOptions
  );
  assert.deepEqual(detail.chats.map((chat) => chat.chatId), ['c2', 'c1']);
  assert.equal(detail.chats[0]?.runs, 2);
  assert.equal(detail.chats[0]?.costUsd, 1.1);
  // A chat can be deleted while its runs remain accounted for; a blank cell would look like a bug.
  assert.equal(detail.chats[0]?.title, 'Deleted chat');
  assert.equal(detail.chats[1]?.title, 'First chat');
});

test('per-run cost is rounded like every other figure', () => {
  const detail = aggregateProject([record({ costUsd: 0.057416999999999996 })], detailOptions);
  assert.equal(detail.runs[0]?.costUsd, 0.0574);
});

test('a project with no recorded runs reports empty rather than throwing', () => {
  const detail = aggregateProject([record({ projectId: 'other' })], detailOptions);
  assert.equal(detail.totals.runs, 0);
  assert.deepEqual(detail.runs, []);
  assert.deepEqual(detail.chats, []);
  assert.equal(detail.models.length, 0);
});

