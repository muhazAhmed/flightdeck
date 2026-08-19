import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ProjectOverview } from '../shared/types.ts';
import { attentionFor, byAttention, lastActivityAt, STALE_AFTER_MS } from '../client/features/deck/attention.ts';
import { ProjectCard } from '../client/features/deck/ProjectCard.tsx';

/**
 * The deck's ranking.
 *
 * Tested because the failure is invisible: a deck that sorts badly still renders twenty perfectly nice
 * cards, and the repository with work rotting in it since Tuesday is simply somewhere in the middle.
 */
const NOW = Date.parse('2026-08-19T12:00:00.000Z');
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
    error: null,
    ...overrides
  };
}

test('a clean repository asks for nothing', () => {
  const attention = attentionFor(project(), NOW);
  assert.equal(attention.severity, 'calm');
  assert.deepEqual(attention.reasons, []);
  assert.equal(attention.score, 0);
});

test('work sitting for days reads differently from work in progress', () => {
  const fresh = attentionFor(project({ unstagedCount: 2, dirtySince: new Date(NOW - HOUR).toISOString() }), NOW);
  const stale = attentionFor(
    project({ unstagedCount: 2, dirtySince: new Date(NOW - 3 * 24 * HOUR).toISOString() }),
    NOW
  );

  assert.equal(fresh.severity, 'info');
  assert.deepEqual(fresh.reasons, ['2 changes']);

  // The case the whole screen exists for: it says how long, and it outranks everything routine.
  assert.equal(stale.severity, 'warn');
  assert.deepEqual(stale.reasons, ['2 changes for 3 days']);
  assert.ok(stale.score > fresh.score);
});

test('the stale threshold is a day, measured from the oldest change', () => {
  const justUnder = attentionFor(
    project({ unstagedCount: 1, dirtySince: new Date(NOW - (STALE_AFTER_MS - HOUR)).toISOString() }),
    NOW
  );
  const justOver = attentionFor(
    project({ unstagedCount: 1, dirtySince: new Date(NOW - (STALE_AFTER_MS + HOUR)).toISOString() }),
    NOW
  );
  assert.equal(justUnder.severity, 'info');
  assert.equal(justOver.severity, 'warn');
});

test('a missing folder outranks every other state', () => {
  const missing = attentionFor(project({ missing: true }), NOW);
  const bad = attentionFor(
    project({ unstagedCount: 40, ahead: 9, behind: 9, dirtySince: new Date(NOW - 40 * 24 * HOUR).toISOString() }),
    NOW
  );
  assert.equal(missing.severity, 'danger');
  assert.ok(missing.score > bad.score, 'nothing on a missing repository can be trusted');
});

test('unpushed commits and being behind are both reported, in that order of weight', () => {
  const ahead = attentionFor(project({ ahead: 3 }), NOW);
  const behind = attentionFor(project({ behind: 3 }), NOW);
  assert.deepEqual(ahead.reasons, ['3 commits unpushed']);
  assert.deepEqual(behind.reasons, ['3 commits behind']);
  // Work only you have is more urgent than work you have not collected yet.
  assert.ok(ahead.score > behind.score);
});

test('a local-only branch is noted but is never a reason on its own', () => {
  const local = attentionFor(project({ tracking: null }), NOW);
  assert.deepEqual(local.reasons, ['No upstream']);
  // Plenty of local repositories are perfectly healthy, so it must not raise the severity.
  assert.equal(local.severity, 'calm');
});

test('counts are pluralised, because "1 changes" is the tell of a generated UI', () => {
  assert.deepEqual(attentionFor(project({ unstagedCount: 1 }), NOW).reasons, ['1 change']);
  assert.deepEqual(attentionFor(project({ ahead: 1 }), NOW).reasons, ['1 commit unpushed']);
});

test('the ranking puts what wants you first and sinks the clean ones', () => {
  const stale = project({
    projectId: 'stale',
    unstagedCount: 2,
    dirtySince: new Date(NOW - 3 * 24 * HOUR).toISOString()
  });
  const unpushed = project({ projectId: 'unpushed', ahead: 2 });
  const busy = project({ projectId: 'busy', unstagedCount: 1, dirtySince: new Date(NOW - HOUR).toISOString() });
  const clean = project({ projectId: 'clean' });
  const gone = project({ projectId: 'gone', missing: true });

  const order = [clean, busy, gone, unpushed, stale].sort((a, b) => byAttention(a, b, NOW)).map((p) => p.projectId);
  assert.deepEqual(order, ['gone', 'stale', 'unpushed', 'busy', 'clean']);
});

test('equally calm projects are ordered by recency, not by name', () => {
  const older = project({ projectId: 'older', lastCommitAt: new Date(NOW - 40 * HOUR).toISOString() });
  const newer = project({ projectId: 'newer', lastCommitAt: new Date(NOW - 2 * HOUR).toISOString() });
  // Among clean repositories, the one you were in an hour ago is the one you are coming back to;
  // alphabetical order carries no information at all.
  assert.deepEqual([older, newer].sort((a, b) => byAttention(a, b, NOW)).map((p) => p.projectId), ['newer', 'older']);
});

test('last activity takes the most recent of commit, agent run, and dirty file', () => {
  const agentLatest = project({
    lastCommitAt: new Date(NOW - 40 * HOUR).toISOString(),
    lastAgentRunAt: new Date(NOW - HOUR).toISOString()
  });
  assert.equal(lastActivityAt(agentLatest), NOW - HOUR);
  assert.equal(lastActivityAt(project({ lastCommitAt: null, lastAgentRunAt: null, dirtySince: null })), 0);
});

const render = (overview: ProjectOverview) =>
  renderToStaticMarkup(
    <Tooltip.Provider>
      <ProjectCard project={overview} onOpen={() => {}} />
    </Tooltip.Provider>
  );

test('a card shows the branch, the reason, and the last commit', () => {
  const html = render(
    project({
      name: 'api-server',
      branch: 'feature-x',
      unstagedCount: 2,
      dirtySince: new Date(Date.now() - 3 * 24 * HOUR).toISOString(),
      lastCommitSubject: 'Add the limiter'
    })
  );
  assert.match(html, />api-server</);
  assert.match(html, />feature-x</);
  assert.match(html, /2 changes for 3 days/);
  assert.match(html, />Add the limiter</);
});

test('a card with no commits says so rather than rendering an empty line', () => {
  assert.match(render(project({ lastCommitSubject: null, lastCommitAt: null })), /No commits yet/);
});

test('count badges are filled and circular, per the badge rule', () => {
  const html = render(project({ unstagedCount: 3 }));
  // Surface-on-surface badges measured 1.1:1 and vanished; the fix was a filled shape with white
  // text. `size-5` rather than min-w plus padding, which produced ovals.
  assert.match(html, /size-5/);
  assert.match(html, /text-white/);
  assert.ok(!/min-w-5/.test(html));
});

test('the deck is read on open, not polled', () => {
  const source = readFileSync('client/features/deck/useDeck.ts', 'utf8');
  // Twenty repositories is forty git processes: cheap once, rude every ten seconds.
  assert.ok(!/setInterval/.test(source), 'the deck must not poll');
  assert.match(source, /if \(open\) void load\(\)/);
});

test('the server reads repositories with a bounded pool and per-repo timeouts', () => {
  const source = readFileSync('server/routes/overview.ts', 'utf8');
  // A wedged repository on a network drive must not hold the deck up, and forty simultaneous spawns
  // help nobody.
  assert.match(source, /const CONCURRENCY = \d+/);
  assert.match(source, /GIT_TIMEOUT_MS/);
  // One unreadable repository must not cost the other nineteen their card.
  assert.match(source, /\.catch\(/);
});
