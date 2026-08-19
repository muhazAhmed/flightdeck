/**
 * The usage log: one line per finished run.
 *
 * WHY A SEPARATE FILE. `state.json` is rewritten atomically on every change, so appending thousands of
 * run records to it would mean rewriting the whole document to add 300 bytes. An append-only JSONL file
 * is the right shape for a log: one `appendFileSync` per run, and a corrupt tail costs one line rather
 * than the file.
 *
 * WHY RECORD AT ALL. The CLI reports a run's cost and tokens once, in the `result` event, and then
 * forgets it. Nothing accumulates that per repository over weeks — so "which client is eating my
 * five-hour window" and "what did a month on this repo actually cost" are unanswerable today.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ProjectUsageReport,
  UsageByDay,
  UsageByModel,
  UsageByProject,
  UsageRecord,
  UsageReport,
  UsageRunRow,
  UsageTotals
} from '@shared/types';
import { stateDir } from './platform.js';

/**
 * The quota window Claude Code reports is five hours.
 *
 * Used only as a fallback: when a real `rate_limit_event` has been seen, its `resetsAt` defines the
 * window instead. Approximating is better than showing nothing, and the UI says which it used.
 */
export const WINDOW_MS = 5 * 60 * 60 * 1000;

/**
 * How many individual runs the detail view lists.
 *
 * A cap rather than everything, because a table of 4000 rows is not detail, it is a wall. What is
 * dropped is counted and said out loud — a silently truncated list reads as "that is all there was".
 */
export const RUN_ROW_LIMIT = 250;

export function usagePath(): string {
  return join(stateDir(), 'usage.jsonl');
}

/** Append one run. Never throws: losing a usage line must not fail the run that produced it. */
export function append(record: UsageRecord): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(usagePath(), `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Accounting is a convenience. A read-only disk should not turn a successful agent run into an
    // error the user has to interpret.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Read the log.
 *
 * Every line is validated rather than trusted: this file is appended to by a process that can be killed
 * mid-write, so a truncated last line is normal, not exceptional. A bad line is skipped.
 */
export function read(path = usagePath()): UsageRecord[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const records: UsageRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const at = typeof parsed.at === 'string' ? parsed.at : null;
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId : null;
    // A record without a time or a project cannot be aggregated by either axis.
    if (!at || !projectId || Number.isNaN(Date.parse(at))) continue;

    records.push({
      at,
      projectId,
      chatId: typeof parsed.chatId === 'string' ? parsed.chatId : '',
      model: typeof parsed.model === 'string' ? parsed.model : null,
      numTurns: num(parsed.numTurns),
      durationMs: num(parsed.durationMs),
      costUsd: num(parsed.costUsd),
      inputTokens: num(parsed.inputTokens),
      outputTokens: num(parsed.outputTokens),
      cacheReadTokens: num(parsed.cacheReadTokens),
      cacheCreationTokens: num(parsed.cacheCreationTokens),
      isError: parsed.isError === true,
      denials: num(parsed.denials)
    });
  }
  return records;
}

function emptyTotals(): UsageTotals {
  return {
    runs: 0,
    turns: 0,
    durationMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    errors: 0
  };
}

function add(totals: UsageTotals, record: UsageRecord): void {
  totals.runs += 1;
  totals.turns += record.numTurns;
  totals.durationMs += record.durationMs;
  totals.costUsd += record.costUsd;
  totals.inputTokens += record.inputTokens;
  totals.outputTokens += record.outputTokens;
  totals.cacheReadTokens += record.cacheReadTokens;
  totals.cacheCreationTokens += record.cacheCreationTokens;
  if (record.isError) totals.errors += 1;
}

/** Cost in whole cents, so a table of $0.4573620000000001 does not appear anywhere. */
function round(totals: UsageTotals): UsageTotals {
  return { ...totals, costUsd: Math.round(totals.costUsd * 10000) / 10000 };
}

/** Local `YYYY-MM-DD`. "Which day did I do that" is a local question, never a UTC one. */
function localDay(at: string): string {
  const date = new Date(at);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function byProject(records: UsageRecord[], nameOf: (projectId: string) => string): UsageByProject[] {
  const groups = new Map<string, { totals: UsageTotals; lastRunAt: string | null }>();
  for (const record of records) {
    const group = groups.get(record.projectId) ?? { totals: emptyTotals(), lastRunAt: null };
    add(group.totals, record);
    if (!group.lastRunAt || Date.parse(record.at) > Date.parse(group.lastRunAt)) group.lastRunAt = record.at;
    groups.set(record.projectId, group);
  }

  const total = records.reduce((sum, record) => sum + record.costUsd, 0);
  return [...groups.entries()]
    .map(([projectId, group]) => ({
      projectId,
      name: nameOf(projectId),
      ...round(group.totals),
      // Share of cost, not of runs: one Opus refactor outweighs thirty Haiku edits.
      share: total > 0 ? group.totals.costUsd / total : 0,
      lastRunAt: group.lastRunAt
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);
}

/**
 * Aggregate records into the report the UI renders.
 *
 * Pure, and separate from the route, so the arithmetic can be tested against fixtures — a total that is
 * quietly wrong is indistinguishable from a total that is right.
 */
export function aggregate(
  records: UsageRecord[],
  options: {
    days: number;
    now: number;
    nameOf: (projectId: string) => string;
    /** Unix seconds from the CLI's own rate-limit event, when one has been seen. */
    windowResetsAt: number | null;
    rateLimitType: string | null;
  }
): UsageReport {
  const { days, now, nameOf, windowResetsAt, rateLimitType } = options;

  const sinceMs = days > 0 ? now - days * 24 * 60 * 60 * 1000 : null;
  const inPeriod = sinceMs === null ? records : records.filter((r) => Date.parse(r.at) >= sinceMs);

  const totals = emptyTotals();
  const models = new Map<string, UsageTotals>();
  const daily = new Map<string, UsageTotals>();

  for (const record of inPeriod) {
    add(totals, record);

    const model = record.model ?? 'unknown';
    const modelTotals = models.get(model) ?? emptyTotals();
    add(modelTotals, record);
    models.set(model, modelTotals);

    const day = localDay(record.at);
    const dayTotals = daily.get(day) ?? emptyTotals();
    add(dayTotals, record);
    daily.set(day, dayTotals);
  }

  const modelList: UsageByModel[] = [...models.entries()]
    .map(([model, modelTotals]) => ({
      model,
      ...round(modelTotals),
      share: totals.costUsd > 0 ? modelTotals.costUsd / totals.costUsd : 0
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const dayList: UsageByDay[] = [...daily.entries()]
    .map(([day, dayTotals]) => ({ day, ...round(dayTotals) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  // The window the quota actually resets on, when the CLI has told us; else the last five hours.
  const windowStartMs = windowResetsAt !== null ? windowResetsAt * 1000 - WINDOW_MS : now - WINDOW_MS;
  const inWindow = records.filter((record) => {
    const at = Date.parse(record.at);
    return at >= windowStartMs && at <= now;
  });
  const windowTotals = emptyTotals();
  for (const record of inWindow) add(windowTotals, record);

  return {
    days,
    since: sinceMs === null ? null : new Date(sinceMs).toISOString(),
    totals: round(totals),
    projects: byProject(inPeriod, nameOf),
    models: modelList,
    daily: dayList,
    window: {
      resetsAt: windowResetsAt,
      rateLimitType,
      startedAt: new Date(windowStartMs).toISOString(),
      totals: round(windowTotals),
      projects: byProject(inWindow, nameOf)
    }
  };
}

/**
 * Everything recorded for one project.
 *
 * Shares `add`/`round` with the cross-project report so the detail totals can never disagree with the row
 * the deck-level table shows for the same project — two implementations of the same sum is how a UI ends
 * up arguing with itself.
 */
export function aggregateProject(
  records: UsageRecord[],
  options: {
    projectId: string;
    days: number;
    now: number;
    name: string;
    /** Chat title at report time; a deleted chat still has runs to account for. */
    titleOf: (chatId: string) => string;
    limit?: number;
  }
): ProjectUsageReport {
  const { projectId, days, now, name, titleOf, limit = RUN_ROW_LIMIT } = options;

  const sinceMs = days > 0 ? now - days * 24 * 60 * 60 * 1000 : null;
  const mine = records
    .filter((record) => record.projectId === projectId)
    .filter((record) => sinceMs === null || Date.parse(record.at) >= sinceMs)
    // Newest first: the run you are looking for is almost always the last one.
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const totals = emptyTotals();
  const models = new Map<string, UsageTotals>();
  const daily = new Map<string, UsageTotals>();
  const chats = new Map<string, { runs: number; costUsd: number; lastRunAt: string }>();

  for (const record of mine) {
    add(totals, record);

    const model = record.model ?? 'unknown';
    const modelTotals = models.get(model) ?? emptyTotals();
    add(modelTotals, record);
    models.set(model, modelTotals);

    const day = localDay(record.at);
    const dayTotals = daily.get(day) ?? emptyTotals();
    add(dayTotals, record);
    daily.set(day, dayTotals);

    const chat = chats.get(record.chatId) ?? { runs: 0, costUsd: 0, lastRunAt: record.at };
    chat.runs += 1;
    chat.costUsd += record.costUsd;
    if (Date.parse(record.at) > Date.parse(chat.lastRunAt)) chat.lastRunAt = record.at;
    chats.set(record.chatId, chat);
  }

  const runs: UsageRunRow[] = mine.slice(0, limit).map((record) => ({
    at: record.at,
    chatId: record.chatId,
    chatTitle: titleOf(record.chatId),
    model: record.model,
    numTurns: record.numTurns,
    durationMs: record.durationMs,
    costUsd: Math.round(record.costUsd * 10000) / 10000,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheCreationTokens: record.cacheCreationTokens,
    isError: record.isError,
    denials: record.denials
  }));

  return {
    projectId,
    name,
    days,
    since: sinceMs === null ? null : new Date(sinceMs).toISOString(),
    totals: round(totals),
    models: [...models.entries()]
      .map(([model, modelTotals]) => ({
        model,
        ...round(modelTotals),
        share: totals.costUsd > 0 ? modelTotals.costUsd / totals.costUsd : 0
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    daily: [...daily.entries()]
      .map(([day, dayTotals]) => ({ day, ...round(dayTotals) }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    runs,
    omittedRuns: Math.max(0, mine.length - runs.length),
    chats: [...chats.entries()]
      .map(([chatId, chat]) => ({
        chatId,
        title: titleOf(chatId),
        runs: chat.runs,
        costUsd: Math.round(chat.costUsd * 10000) / 10000,
        lastRunAt: chat.lastRunAt
      }))
      .sort((a, b) => b.costUsd - a.costUsd)
  };
}

