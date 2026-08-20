import type { ProjectOverview } from '@shared/types';
import { byAttention, lastActivityAt } from './attention';

/**
 * Narrowing the deck, and choosing what "first" means.
 *
 * Ranking answers "what wants me?" — but not "where is the repo I know the name of", and not "which of
 * these has a server running". Twenty cards is past the point where scanning is faster than typing,
 * and it is exactly where a wrong default sort becomes expensive.
 *
 * Pure, and separate from the components, for the same reason `attention.ts` is: a filter that quietly
 * drops a project still renders a perfectly nice deck.
 */

export type FilterId = 'all' | 'dirty' | 'unpushed' | 'behind' | 'shell' | 'problem';

export interface FilterSpec {
  id: FilterId;
  label: string;
  /** Said on the chip, because "dirty" and "problem" are not self-explanatory at a glance. */
  hint: string;
  matches: (project: ProjectOverview) => boolean;
}

const changesOf = (project: ProjectOverview): number =>
  project.stagedCount + project.unstagedCount + project.untrackedCount;

/** Chip order is the order you ask the questions in, not alphabetical. */
export const FILTERS: FilterSpec[] = [
  { id: 'all', label: 'All', hint: 'Every project', matches: () => true },
  {
    id: 'dirty',
    label: 'Uncommitted',
    hint: 'Has staged, modified or untracked files',
    matches: (project) => changesOf(project) > 0
  },
  {
    id: 'unpushed',
    label: 'Unpushed',
    hint: 'Has commits the remote has not seen',
    matches: (project) => project.ahead > 0
  },
  {
    id: 'behind',
    label: 'Behind',
    hint: 'The remote has commits you do not',
    matches: (project) => project.behind > 0
  },
  {
    id: 'shell',
    label: 'Shell running',
    hint: 'A shell is alive in this project — often a dev server',
    matches: (project) => project.shellRunning
  },
  {
    id: 'problem',
    label: 'Problems',
    hint: 'The folder is gone, or git could not be read',
    matches: (project) => project.missing || project.error !== null
  }
];

export type SortId = 'attention' | 'activity' | 'name' | 'changes';

export interface SortSpec {
  id: SortId;
  label: string;
  hint: string;
}

export const SORTS: SortSpec[] = [
  { id: 'attention', label: 'What wants you', hint: 'Stale work, then unpushed, then the rest' },
  { id: 'activity', label: 'Recently active', hint: 'Last commit, agent run or edit' },
  { id: 'changes', label: 'Most changes', hint: 'By number of changed files' },
  { id: 'name', label: 'Name', hint: 'Alphabetical, for when you know what you are looking for' }
];

/**
 * Free-text match over name and path.
 *
 * Both, because half the time you remember the folder and not the project name. Case-insensitive and
 * substring rather than fuzzy: fuzzy matching over twenty short names mostly produces surprises, and
 * `\` in a Windows path would need escaping in any pattern language.
 */
export function matchesQuery(project: ProjectOverview, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    project.name.toLowerCase().includes(needle) ||
    project.path.toLowerCase().replace(/\\/g, '/').includes(needle.replace(/\\/g, '/'))
  );
}

export function filterOf(id: FilterId): FilterSpec {
  return FILTERS.find((filter) => filter.id === id) ?? (FILTERS[0] as FilterSpec);
}

/** How many projects each chip would show, so a chip can say whether it is worth pressing. */
export function countsByFilter(projects: ProjectOverview[]): Record<FilterId, number> {
  const counts = {} as Record<FilterId, number>;
  for (const filter of FILTERS) counts[filter.id] = projects.filter(filter.matches).length;
  return counts;
}

/**
 * Apply the query, the chip and the sort.
 *
 * `now` is passed in rather than read here so a ranking cannot shift mid-interaction — `byAttention`
 * reads the clock, and cards moving under the pointer is worse than a ranking a minute out of date.
 */
export function arrange(
  projects: ProjectOverview[],
  options: { query: string; filter: FilterId; sort: SortId; now: number }
): ProjectOverview[] {
  const spec = filterOf(options.filter);
  const visible = projects.filter((project) => spec.matches(project) && matchesQuery(project, options.query));

  const sorted = [...visible];
  switch (options.sort) {
    case 'activity':
      sorted.sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
      break;
    case 'changes':
      // Attention as the tie-break, so twenty clean projects are not left in arbitrary order.
      sorted.sort((a, b) => changesOf(b) - changesOf(a) || byAttention(a, b, options.now));
      break;
    case 'name':
      // localeCompare, so `Émile` sorts next to `E` rather than after `Z`.
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      break;
    default:
      sorted.sort((a, b) => byAttention(a, b, options.now));
  }
  return sorted;
}
