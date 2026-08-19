import type { ProjectOverview } from '@shared/types';

/**
 * Which projects want you, and in what order.
 *
 * A deck of twenty equal cards is a list, not an answer. The point is that the repository with work
 * rotting in it since Tuesday sits at the top and the six clean ones sink — so this decides both the
 * badges a card shows and where it lands.
 *
 * Pure and separate from the components so the ranking can be tested against fixtures; the failure
 * mode otherwise is a deck that looks fine and buries the thing you needed to see.
 */

/** Work sitting longer than this reads as forgotten rather than in progress. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type Severity = 'danger' | 'warn' | 'info' | 'calm';

export interface Attention {
  severity: Severity;
  /** Short phrases for the card, most important first. */
  reasons: string[];
  /** Higher sorts earlier. Only meaningful relative to other cards. */
  score: number;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Rough age in words. Deliberately vague past a week — "12d" and "3w" call for the same action. */
function age(since: string, now: number): string {
  const ms = now - Date.parse(since);
  if (Number.isNaN(ms) || ms < 0) return 'just now';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, 'day');
  const weeks = Math.floor(days / 7);
  return plural(weeks, 'week');
}

export function attentionFor(project: ProjectOverview, now = Date.now()): Attention {
  // A folder that moved or stopped being a repository outranks everything: nothing else on the card
  // can be trusted, and no other state is fixed by looking at it.
  if (project.missing) {
    return { severity: 'danger', reasons: ['Folder is missing'], score: 1000 };
  }
  if (project.error) {
    return { severity: 'danger', reasons: ['Could not read this repository'], score: 900 };
  }

  const reasons: string[] = [];
  let score = 0;
  let severity: Severity = 'calm';

  const changes = project.stagedCount + project.unstagedCount + project.untrackedCount;
  const stale = project.dirtySince !== null && now - Date.parse(project.dirtySince) > STALE_AFTER_MS;

  if (changes > 0 && stale && project.dirtySince) {
    // The headline case this whole screen exists for.
    reasons.push(`${plural(changes, 'change')} for ${age(project.dirtySince, now)}`);
    score += 400;
    severity = 'warn';
  } else if (changes > 0) {
    reasons.push(plural(changes, 'change'));
    score += 100;
    severity = 'info';
  }

  if (project.ahead > 0) {
    reasons.push(`${plural(project.ahead, 'commit')} unpushed`);
    score += 200;
    if (severity === 'calm') severity = 'info';
  }

  if (project.behind > 0) {
    reasons.push(`${plural(project.behind, 'commit')} behind`);
    score += 50;
    if (severity === 'calm') severity = 'info';
  }

  // Said last, and never a reason on its own: plenty of local-only repos are perfectly healthy.
  if (project.branch !== null && project.tracking === null) {
    reasons.push('No upstream');
    score += 10;
  }

  return { severity, reasons, score };
}

/** The most recent thing that happened here, whatever kind of thing it was. */
export function lastActivityAt(project: ProjectOverview): number {
  const times = [project.dirtySince, project.lastAgentRunAt, project.lastCommitAt]
    .filter((at): at is string => typeof at === 'string')
    .map((at) => Date.parse(at))
    .filter((ms) => !Number.isNaN(ms));
  return times.length === 0 ? 0 : Math.max(...times);
}

/**
 * Sort by how much a project wants you, then by recency.
 *
 * Recency as the tie-break rather than name: among six clean repositories, the one you were in an hour
 * ago is the one you are coming back to. Alphabetical order carries no information at all.
 */
export function byAttention(a: ProjectOverview, b: ProjectOverview, now = Date.now()): number {
  const difference = attentionFor(b, now).score - attentionFor(a, now).score;
  if (difference !== 0) return difference;
  return lastActivityAt(b) - lastActivityAt(a);
}
