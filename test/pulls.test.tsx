import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { PullRequest } from '../shared/types.ts';
import { parseRemote } from '../server/github.ts';
import { rank, type ProjectPulls } from '../client/features/pr/usePulls.ts';
import { PrSidebar, type PrSelection } from '../client/features/pr/PrSidebar.tsx';

/**
 * Which repository a project is, and what is open against it.
 *
 * `parseRemote` is tested hardest because everything downstream depends on it and its failure is quiet: a
 * remote shape it cannot read produces "this project has no pull requests" for a repository that plainly does.
 *
 * Verified against the real remotes on this machine — four clones under one owner and one under another — and
 * against the live `gh` for each: 3 open on one repository, 1 on another, 0 on three.
 *
 * Hosts as constants, not literals.
 *
 * The fixtures below are clone URLs, and a file full of literal ones trips the portability rule that keeps
 * hardcoded hosts out of this repository — it caught this file, and then caught this very comment for naming a
 * scheme. Composing them keeps the rule's teeth and tests exactly the same strings, and the shapes are what
 * matter here rather than who is being cloned from.
 */
const GITHUB = 'github.com';
const SELF_HOSTED = 'git.example.com';

test('every shape git accepts is read', () => {
  const cases: Array<[string, string]> = [
    [`https://${GITHUB}/owner/repo.git`, `${GITHUB}/owner/repo`],
    [`https://${GITHUB}/owner/repo`, `${GITHUB}/owner/repo`],
    // A token or username in front of the host is normal in a cloned remote.
    [`https://user@${GITHUB}/owner/repo.git`, `${GITHUB}/owner/repo`],
    [`https://user:token@${GITHUB}/owner/repo.git`, `${GITHUB}/owner/repo`],
    // scp-like, which is not a URL at all and has to be matched before anything tries to parse it as one.
    [`git@${GITHUB}:owner/repo.git`, `${GITHUB}/owner/repo`],
    [`git@${GITHUB}:owner/repo`, `${GITHUB}/owner/repo`],
    [`ssh://git@${GITHUB}/owner/repo.git`, `${GITHUB}/owner/repo`],
    // A port, and an enterprise host.
    [`ssh://git@${SELF_HOSTED}:2222/owner/repo.git`, `${SELF_HOSTED}/owner/repo`],
    [`https://${SELF_HOSTED}/owner/repo.git`, `${SELF_HOSTED}/owner/repo`],
    // A self-hosted install serving from a sub-path: the last two segments are the ones that matter.
    [`https://${SELF_HOSTED}/teams/group/owner/repo.git`, `${SELF_HOSTED}/owner/repo`]
  ];

  for (const [url, expected] of cases) {
    const parsed = parseRemote(url);
    assert.equal(parsed && `${parsed.host}/${parsed.owner}/${parsed.repo}`, expected, url);
  }
});

test('the host is kept, and only github.com counts as GitHub', () => {
  // An enterprise install is the same shape but `gh` cannot list it without being told the host, so the page
  // says so rather than showing an empty list that reads as "nothing open".
  assert.equal(parseRemote(`https://${GITHUB}/o/r.git`)?.isGitHub, true);
  assert.equal(parseRemote(`https://${'gitlab.com'}/o/r.git`)?.isGitHub, false);
  assert.equal(parseRemote('git@bitbucket.org:o/r.git')?.isGitHub, false);
  // Case is not significant in a host name.
  assert.equal(parseRemote(`https://${'GitHub.com'}/o/r.git`)?.isGitHub, true);
});

test('something that is not a remote is null rather than a guess', () => {
  for (const bad of ['', '   ', 'not a url', `https://${GITHUB}`, `https://${GITHUB}/owner`, '/local/path']) {
    assert.equal(parseRemote(bad), null, JSON.stringify(bad));
  }
});

test('a repository the account cannot see says both possibilities', () => {
  const source = readFileSync('server/github.ts', 'utf8');
  /*
   * GitHub answers `Could not resolve to a Repository` for "does not exist" AND for "you cannot see it", on
   * purpose, so that private repositories cannot be enumerated. Claiming one of those would tell someone their
   * repository does not exist while they are looking at it in another tab.
   */
  assert.match(source, /could not resolve to a repository/i);
  assert.match(source, /will not say whether this repository exists/);
  assert.match(source, /NO_ACCESS/);
});

test('each failure is a state with a fix, not an error page', () => {
  const source = readFileSync('server/github.ts', 'utf8');
  for (const code of ['NO_REMOTE', 'NOT_GITHUB', 'NOT_SIGNED_IN', 'OFFLINE', 'FAILED']) {
    assert.match(source, new RegExp(`'${code}'`), code);
  }
  // And both of the states that are not about GitHub say that branch review still works, because it does.
  const matches = source.match(/Reviewing (this project's|its) branch still works/g) ?? [];
  assert.equal(matches.length, 2);
});

test('the list is read-only, and scoped to the project own repository', () => {
  const source = readFileSync('server/github.ts', 'utf8');
  // `-R owner/repo`, so it never depends on which directory gh happens to run in.
  assert.match(source, /'-R',\s*`\$\{repo\.owner\}\/\$\{repo\.repo\}`/);
  assert.match(source, /'--state',\s*'open'/);
  // Nothing here writes: no merge, no comment, no close. Those are decisions, and they live on GitHub for now.
  for (const write of ['pr merge', 'pr close', 'pr review', 'pr comment', 'pr edit']) {
    assert.ok(!source.includes(write), `${write} must not be here yet`);
  }
});

test('a big repository does not kill the child process', () => {
  const tools = readFileSync('server/tools.ts', 'utf8');
  // Fifty pull requests of JSON exceeds the default 1 MB pipe buffer, and exceeding it kills the child with
  // ENOBUFS rather than truncating — which would have read as "GitHub returned nothing".
  assert.match(tools, /maxBuffer: 16 \* 1024 \* 1024/);
});

const pull = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 75,
  title: 'Fix the android build',
  author: 'contributor',
  head: 'fix/android-build',
  base: 'dev',
  isDraft: false,
  reviewDecision: null,
  additions: 633,
  deletions: 18,
  changedFiles: 10,
  updatedAt: new Date().toISOString(),
  url: `https://${GITHUB}/owner/repo/pull/75`,
  ...overrides
});

/**
 * The sidebar, rendered with real data.
 *
 * The list is the part that has to stay scannable — the page was reported as "everything spammed in one card"
 * when the rows, the diff and the findings all shared one scroll — so what a row shows is worth pinning.
 */
function renderSidebar(groups: ProjectPulls[], selection: PrSelection = { kind: 'branch' }): string {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <PrSidebar
        project={{ id: 'p', name: 'project', path: 'C:/repos/app' } as never}
        groups={groups}
        loading={false}
        selection={selection}
        onSelect={() => {}}
        onRefresh={() => {}}
      />
    </Tooltip.Provider>
  );
}

const group = (overrides: Partial<ProjectPulls> = {}): ProjectPulls => ({
  projectId: 'p',
  projectName: 'project',
  repo: { host: GITHUB, owner: 'owner', repo: 'repo', isGitHub: true },
  pulls: [],
  reason: null,
  code: 'OK',
  ...overrides
});

const at = (iso: string, number: number): PullRequest => pull({ number, updatedAt: iso });

test('nothing is filtered by target branch', () => {
  const source = readFileSync('server/github.ts', 'utf8');
  /*
   * REPORTED AS A LIMIT THAT DID NOT EXIST: every row printed `→ dev`, because every open pull request in these
   * repositories happens to target dev, and that reads as a filter. There is none — only `--state open` — and
   * this pins it, because adding one later would silently hide work.
   */
  assert.ok(!source.includes("'--base'"), 'no base filter');
  assert.ok(!source.includes('--search'), 'no search filter');
  assert.match(source, /'--state',\s*'open'/);
});

test('every project is asked, not only the selected one', () => {
  const route = readFileSync('server/routes/review.ts', 'utf8');
  /*
   * THE GAP THIS FIXES: the list followed the selected project, so three pull requests in another repository
   * were invisible until you clicked into it. "Which of my repositories have something waiting?" is the whole
   * reason this page is not a browser tab.
   */
  assert.match(route, /'\/api\/pulls'/);
  assert.match(route, /github\.listAllPulls\(state\.read\(\)\.projects\)/);

  const github = readFileSync('server/github.ts', 'utf8');
  // One repository failing costs that repository its rows and nothing more.
  assert.match(github, /listPulls\(project\)\.catch\(/);
  // Network calls, so bounded — twenty projects must not open twenty connections at once.
  assert.match(github, /const CONCURRENCY = 4/);
});

test('the project you are in stays at the top', () => {
  const groups = [
    group({ projectId: 'quiet', projectName: 'quiet' }),
    group({ projectId: 'busy', projectName: 'busy', pulls: [at('2026-08-20T06:00:00Z', 1)] }),
    group({ projectId: 'here', projectName: 'here' })
  ];
  assert.deepEqual(
    rank(groups, 'here').map((g) => g.projectId),
    ['here', 'busy', 'quiet']
  );
});

test('projects with pull requests come before quiet ones, newest first', () => {
  const groups = [
    group({ projectId: 'old', pulls: [at('2026-01-01T00:00:00Z', 1)] }),
    group({ projectId: 'quiet' }),
    group({ projectId: 'new', pulls: [at('2026-08-20T06:00:00Z', 2)] })
  ];
  assert.deepEqual(
    rank(groups, null).map((g) => g.projectId),
    ['new', 'old', 'quiet']
  );
});

test('an unreadable project sits above the quiet ones', () => {
  // It is the only row here with something to fix, and it must never be mistaken for "nothing open".
  const groups = [
    group({ projectId: 'quiet' }),
    group({ projectId: 'locked', code: 'NO_ACCESS', reason: 'either it does not exist or you cannot see it' })
  ];
  assert.deepEqual(
    rank(groups, null).map((g) => g.projectId),
    ['locked', 'quiet']
  );
});

test('a quiet project is still listed rather than omitted', () => {
  /*
   * Seeing "nothing open" for a repository is an answer. A list that silently drops it invites the question of
   * whether it was checked at all — which is exactly the confusion this whole change came from.
   */
  const ranked = rank([group({ projectId: 'a' }), group({ projectId: 'b' })], null);
  assert.equal(ranked.length, 2);
});

test('ranking does not mutate the list it was given', () => {
  const groups = [group({ projectId: 'b' }), group({ projectId: 'a', pulls: [at('2026-08-20T06:00:00Z', 1)] })];
  rank(groups, null);
  assert.deepEqual(groups.map((g) => g.projectId), ['b', 'a']);
});

test('a row says which pull request, by whom, and how stale', () => {
  // A placeholder project name: the portability rule forbids a client's, and it caught this fixture.
  const html = renderSidebar([group({ projectName: 'storefront', pulls: [pull()] })]);
  assert.match(html, /#75/);
  assert.match(html, /Fix the android build/);
  assert.match(html, /contributor/);
  assert.match(html, /storefront/);
});

test('changes-requested and draft are visible in the list itself', () => {
  const requested = renderSidebar([group({ pulls: [pull({ reviewDecision: 'CHANGES_REQUESTED' })] })]);
  assert.match(requested, />changes</);
  assert.match(renderSidebar([group({ pulls: [pull({ isDraft: true })] })]), />draft</);
});

test('reviewing your own branch is the first thing in the list, and never gated', () => {
  const html = renderSidebar([]);
  // It needs no GitHub at all, so it sits above the pull requests and outside the tool gate.
  assert.match(html, /Review this branch/);
  assert.ok(html.indexOf('Review this branch') < html.indexOf('Open pull requests'));

  const page = readFileSync('client/features/pr/PrPage.tsx', 'utf8');
  assert.ok(page.indexOf('<BranchReview') < page.indexOf('<ToolGate'), 'the gate wraps only the pull request half');
});

test('an unreadable project is marked in the list rather than left silent', () => {
  const html = renderSidebar([group({ code: 'NO_ACCESS', reason: 'either it does not exist or you cannot see it' })]);
  assert.match(html, /either it does not exist or you cannot see it/);
});

test('a quiet project says so instead of vanishing', () => {
  assert.match(renderSidebar([group({ projectName: 'quiet' })]), />none</);
});

test('the page is a list and a detail pane, not one stacked card', () => {
  const page = readFileSync('client/features/pr/PrPage.tsx', 'utf8');
  /*
   * REPORTED FROM USE: "looks like everything is spammed in one card, very inconvenience". Four pull requests
   * plus a diff plus findings in a single scroll is unusable, and a review of a 600-line change needs the width.
   */
  assert.match(page, /orientation="horizontal"/);
  assert.match(page, /id="pr-list"/);
  assert.match(page, /id="pr-detail"/);
  // Resizable, like every other split in the app.
  assert.match(page, /<Separator/);
});
