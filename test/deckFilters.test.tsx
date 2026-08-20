import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ProjectOverview } from '../shared/types.ts';
import { arrange, countsByFilter, filterOf, matchesQuery, FILTERS, SORTS } from '../client/features/deck/filter.ts';
import { ProjectCard } from '../client/features/deck/ProjectCard.tsx';

/**
 * Narrowing the deck, and the shell it can now see.
 *
 * The same reason `deck.test.tsx` exists: a filter that quietly drops a project renders a perfectly nice
 * deck, and the project you were looking for is simply not on it.
 */
const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const HOUR = 3_600_000;

function project(overrides: Partial<ProjectOverview> = {}): ProjectOverview {
  return {
    projectId: 'p',
    name: 'repo',
    path: 'C:/repos/repo',
    missing: false,
    branch: 'main',
    tracking: 'origin/main',
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    lastCommitSubject: 'Do a thing',
    lastCommitAt: new Date(NOW - 2 * HOUR).toISOString(),
    dirtySince: null,
    lastAgentRunAt: null,
    shellRunning: false,
    error: null,
    ...overrides
  };
}

const ids = (projects: ProjectOverview[]): string[] => projects.map((p) => p.projectId);
const all = { query: '', filter: 'all' as const, sort: 'attention' as const, now: NOW };

test('search looks at the path as well as the name', () => {
  // Half the time you remember the folder rather than what the project is called here.
  const web = project({ name: 'storefront', path: 'C:/repos/acme-web/storefront' });
  assert.ok(matchesQuery(web, 'storefront'));
  assert.ok(matchesQuery(web, 'acme-web'));
  assert.ok(!matchesQuery(web, 'invoices'));
});

test('search is case-insensitive and ignores which slash the path uses', () => {
  const win = project({ name: 'Ledger', path: 'C:\\repos\\ledger' });
  assert.ok(matchesQuery(win, 'ledger'));
  // Typing a forward slash must find a backslash path, or search is useless on Windows.
  assert.ok(matchesQuery(win, 'repos/ledger'));
  assert.ok(matchesQuery(win, 'repos\\ledger'));
});

test('an empty query matches everything rather than nothing', () => {
  assert.ok(matchesQuery(project(), ''));
  assert.ok(matchesQuery(project(), '   '));
});

test('each chip selects the state it names', () => {
  const dirty = project({ projectId: 'dirty', unstagedCount: 2 });
  const unpushed = project({ projectId: 'unpushed', ahead: 3 });
  const behind = project({ projectId: 'behind', behind: 1 });
  const shell = project({ projectId: 'shell', shellRunning: true });
  const gone = project({ projectId: 'gone', missing: true });
  const clean = project({ projectId: 'clean' });
  const projects = [dirty, unpushed, behind, shell, gone, clean];

  const only = (filter: Parameters<typeof filterOf>[0]) => ids(arrange(projects, { ...all, filter }));
  assert.deepEqual(only('dirty'), ['dirty']);
  assert.deepEqual(only('unpushed'), ['unpushed']);
  assert.deepEqual(only('behind'), ['behind']);
  assert.deepEqual(only('shell'), ['shell']);
  assert.deepEqual(only('problem'), ['gone']);
  assert.equal(arrange(projects, all).length, 6);
});

test('a repository git could not read counts as a problem, not just a missing folder', () => {
  const broken = project({ projectId: 'broken', error: 'fatal: not a git repository' });
  assert.deepEqual(ids(arrange([broken, project({ projectId: 'ok' })], { ...all, filter: 'problem' })), ['broken']);
});

test('every chip has a hint, since "dirty" and "problem" are not self-explanatory', () => {
  for (const spec of FILTERS) {
    assert.ok(spec.hint.length > 0, `${spec.id} has no hint`);
    assert.ok(spec.label.length > 0);
  }
});

test('an unknown filter id falls back to All rather than emptying the deck', () => {
  // A persisted or hand-edited value must never be able to hide every project.
  assert.equal(filterOf('nonsense' as never).id, 'all');
});

test('counts come from the whole read, so a chip says how many there are', () => {
  const counts = countsByFilter([
    project({ unstagedCount: 1 }),
    project({ unstagedCount: 1, ahead: 2 }),
    project({ shellRunning: true })
  ]);
  assert.equal(counts.all, 3);
  assert.equal(counts.dirty, 2);
  assert.equal(counts.unpushed, 1);
  assert.equal(counts.shell, 1);
  assert.equal(counts.behind, 0);
  assert.equal(counts.problem, 0);
});

test('the filter and the search both apply, not one or the other', () => {
  const projects = [
    project({ projectId: 'a', name: 'web-shop', unstagedCount: 1 }),
    project({ projectId: 'b', name: 'web-admin' }),
    project({ projectId: 'c', name: 'api', unstagedCount: 4 })
  ];
  assert.deepEqual(ids(arrange(projects, { ...all, filter: 'dirty', query: 'web' })), ['a']);
});

test('sorting by name is alphabetical and accent-insensitive', () => {
  const projects = [project({ projectId: 'z', name: 'zeta' }), project({ projectId: 'e', name: 'Émile' }), project({ projectId: 'a', name: 'alpha' })];
  // `Émile` belongs next to E, not after Z, which is where a plain `<` comparison puts it.
  assert.deepEqual(ids(arrange(projects, { ...all, sort: 'name' })), ['a', 'e', 'z']);
});

test('sorting by changes counts staged, modified and untracked together', () => {
  const projects = [
    project({ projectId: 'few', unstagedCount: 1 }),
    project({ projectId: 'many', stagedCount: 2, unstagedCount: 3, untrackedCount: 1 }),
    project({ projectId: 'some', untrackedCount: 3 })
  ];
  assert.deepEqual(ids(arrange(projects, { ...all, sort: 'changes' })), ['many', 'some', 'few']);
});

test('sorting by activity ignores how much a project wants you', () => {
  const stale = project({
    projectId: 'stale',
    unstagedCount: 2,
    dirtySince: new Date(NOW - 5 * 24 * HOUR).toISOString(),
    lastCommitAt: new Date(NOW - 5 * 24 * HOUR).toISOString()
  });
  const quiet = project({ projectId: 'quiet', lastCommitAt: new Date(NOW - HOUR).toISOString() });

  // Attention puts the rotting one first; "recently active" is the other question, and must answer it.
  assert.deepEqual(ids(arrange([quiet, stale], { ...all, sort: 'attention' })), ['stale', 'quiet']);
  assert.deepEqual(ids(arrange([quiet, stale], { ...all, sort: 'activity' })), ['quiet', 'stale']);
});

test('the default sort is still what wants you', () => {
  assert.equal(SORTS[0]?.id, 'attention');
  const source = readFileSync('client/features/deck/useDeck.ts', 'utf8');
  assert.match(source, /useState<SortId>\('attention'\)/);
});

test('arranging does not mutate the list it was given', () => {
  // It is React state; sorting it in place is the kind of bug that only shows up as a stale render.
  const projects = [project({ projectId: 'b', name: 'b' }), project({ projectId: 'a', name: 'a' })];
  arrange(projects, { ...all, sort: 'name' });
  assert.deepEqual(ids(projects), ['b', 'a']);
});

test('the clock is passed in, so a ranking cannot shift mid-interaction', () => {
  const source = readFileSync('client/features/deck/filter.ts', 'utf8');
  // Cards moving under the pointer is worse than a ranking a minute out of date.
  assert.ok(!/Date\.now\(\)/.test(source), 'filter.ts must not read the clock');
});

const render = (overview: ProjectOverview) =>
  renderToStaticMarkup(
    <Tooltip.Provider>
      <ProjectCard project={overview} onOpen={() => {}} onOpenTerminal={() => {}} onStopShell={() => {}} />
    </Tooltip.Provider>
  );

test('a card says when a shell is running in that project, and offers to stop it', () => {
  const html = render(project({ shellRunning: true }));
  assert.match(html, />shell</);
  assert.match(html, /Stop the shell running in this project/);
});

test('a project with no shell shows no shell badge and no stop', () => {
  const html = render(project());
  assert.ok(!/Stop the shell/.test(html));
  assert.ok(!/>shell</.test(html));
});

test('the terminal shortcut is offered on every readable card and withheld on a missing one', () => {
  assert.match(render(project()), /Open this project with a terminal/);
  // Nothing can be run in a folder that is gone; an enabled button there is a promise the app cannot keep.
  assert.match(render(project({ missing: true })), /aria-label="Open this project with a terminal"[^>]*disabled/);
});

test('the card is not a button inside a button', () => {
  const source = readFileSync('client/features/deck/ProjectCard.tsx', 'utf8');
  // Browsers recover from nested buttons by dropping the nesting, which loses a click handler rather
  // than merely looking wrong — so the card carries the role and the keyboard contract by hand.
  assert.match(source, /role="button"/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  // Enter on a nested control must run that control, not open the project.
  assert.match(source, /if \(event\.target !== event\.currentTarget\) return/);
  // And a press on a control must not also count as a press on the card.
  assert.match(source, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test('the deck can stop a shell without being attached to it', () => {
  const route = readFileSync('server/routes/terminal.ts', 'utf8');
  // The WebSocket `stop` only reaches a shell whose panel is open, and shells now outlive their panel.
  assert.match(route, /'\/api\/terminal\/:projectId\/stop'/);
  // Idempotent: stopping a project with no shell is the state the caller wanted, not a 404.
  assert.match(route, /if \(!project\) return \{ stopped: false \}/);

  const overview = readFileSync('server/routes/overview.ts', 'utf8');
  // Read in the same response rather than a second request, or the badge is one refresh behind.
  assert.match(overview, /shellRunning: pty\.isRunning\(project\.id\)/);
});

test('an over-narrow filter reads as "nothing matches", not as an empty deck', () => {
  const page = readFileSync('client/features/deck/DeckPage.tsx', 'utf8');
  assert.match(page, /title="Nothing matches"/);
  assert.match(page, /Show every project/);
  // The two states are distinguished by the unfiltered count, not by the visible one.
  assert.match(page, /totals\.count === 0 \?/);
});
