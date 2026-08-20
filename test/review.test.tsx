import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReviewFinding, ReviewResult } from '../shared/types.ts';
import { buildPrompt, parseReview, rank, reviewChat } from '../server/review.ts';
import { FindingRow } from '../client/features/review/FindingList.tsx';

/**
 * Reviewing a branch before it becomes a pull request.
 *
 * The parser is tested hardest because its failure is the dangerous one: a reply we cannot read must degrade
 * to "here is what it said", never to an empty list — an empty list reads as "nothing to raise", which is the
 * one wrong answer this feature can give.
 *
 * The fixtures are shaped like the real thing. The first run of this feature was against this repository's own
 * uncommitted changes: 28 turns, 17 file reads, ten findings, of which eight were real bugs in the code that
 * had just been written — including three in the review feature itself.
 */
const FENCE = '```';

function reply(body: string): string {
  return `Here is what I found.\n\n${FENCE}json\n${body}\n${FENCE}\n`;
}

const GOOD = reply(
  JSON.stringify({
    summary: 'Adds a PR page and a review endpoint.',
    findings: [
      {
        file: 'server/routes/review.ts',
        line: 75,
        severity: 'medium',
        title: 'Writes to the socket after the client has gone',
        detail: 'A closed tab leaves the run going and every send throws.'
      },
      { file: 'client/features/tools/ToolGate.tsx', line: 31, severity: 'high', title: 'Permanent skeleton', detail: '' }
    ]
  })
);

test('findings are read out of the fenced block', () => {
  const { summary, findings, parsed } = parseReview(GOOD);
  assert.equal(parsed, true);
  assert.equal(summary, 'Adds a PR page and a review endpoint.');
  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.file, 'server/routes/review.ts');
  assert.equal(findings[0]?.line, 75);
  assert.equal(findings[0]?.severity, 'medium');
});

test('a reply with no block is kept as prose rather than reported as clean', () => {
  /*
   * THE DANGEROUS FAILURE. An unparsed reply that produced an empty findings list would render as "nothing to
   * raise" — a review that silently says the change is fine is worse than no review at all.
   */
  const { findings, parsed, summary } = parseReview('I read the diff and it looks fine to me, broadly.');
  assert.equal(parsed, false);
  assert.deepEqual(findings, []);
  assert.equal(summary, null);
});

test('an example block before the answer does not win', () => {
  // The prompt itself shows a JSON example, and a model that echoes it before answering is common.
  const text = [
    'I will use this shape:',
    `${FENCE}json`,
    '{"summary":"the example","findings":[]}',
    FENCE,
    'Here is the real answer:',
    `${FENCE}json`,
    '{"summary":"the answer","findings":[{"file":"a.ts","line":1,"severity":"low","title":"t","detail":"d"}]}',
    FENCE
  ].join('\n');
  const { summary, findings } = parseReview(text);
  assert.equal(summary, 'the answer');
  assert.equal(findings.length, 1);
});

test('malformed JSON degrades to prose, not to silence', () => {
  const { parsed, findings } = parseReview(reply('{"summary":"oops","findings":[{'));
  assert.equal(parsed, false);
  assert.deepEqual(findings, []);
});

test('a finding with no title or no file is dropped', () => {
  /*
   * A finding with nothing to say is noise; one with no file cannot be found. The code checked only the title
   * until the first review of this module pointed out that its own comment claimed both.
   */
  const { findings } = parseReview(
    reply(
      JSON.stringify({
        findings: [
          { file: 'a.ts', line: 1, severity: 'low', title: '', detail: 'no title' },
          { line: 2, severity: 'low', title: 'no file', detail: 'nowhere to go' },
          { file: 'b.ts', line: 3, severity: 'low', title: 'kept', detail: 'fine' }
        ]
      })
    )
  );
  assert.deepEqual(findings.map((f) => f.title), ['kept']);
});

test('a nonsense severity becomes medium rather than breaking the list', () => {
  const { findings } = parseReview(
    reply(JSON.stringify({ findings: [{ file: 'a.ts', line: 1, severity: 'catastrophic', title: 't', detail: 'd' }] }))
  );
  assert.equal(findings[0]?.severity, 'medium');
});

test('a line that is not a line becomes null', () => {
  // "the whole file" is a legitimate answer, and `line: 0` or `line: "n/a"` must not render as `:0`.
  const cases = [{ line: 0 }, { line: -3 }, { line: 'n/a' }, { line: null }, {}];
  for (const extra of cases) {
    const { findings } = parseReview(
      reply(JSON.stringify({ findings: [{ file: 'a.ts', severity: 'low', title: 't', detail: 'd', ...extra }] }))
    );
    assert.equal(findings[0]?.line, null, JSON.stringify(extra));
  }
});

test('backslash paths are normalised, or nothing else could match them', () => {
  const { findings } = parseReview(
    reply(JSON.stringify({ findings: [{ file: 'client\\features\\a.ts', severity: 'low', title: 't', detail: 'd' }] }))
  );
  assert.equal(findings[0]?.file, 'client/features/a.ts');
});

test('the list reads worst-first, then by file', () => {
  const make = (severity: ReviewFinding['severity'], file: string): ReviewFinding => ({
    file,
    line: 1,
    severity,
    title: 't',
    detail: 'd'
  });
  const ordered = rank([make('low', 'a'), make('high', 'z'), make('medium', 'b'), make('high', 'a')]);
  assert.deepEqual(
    ordered.map((f) => `${f.severity}:${f.file}`),
    ['high:a', 'high:z', 'medium:b', 'low:a']
  );
});

test('the prompt tells the agent to fetch the diff itself', () => {
  const prompt = buildPrompt({
    branch: 'feature-x',
    baseRef: 'origin/dev',
    baseSha: 'abc123abc123abc123',
    commits: 2,
    changedFiles: 5,
    uncommitted: 3,
    untracked: ['client/new/'],
    reason: null
  });
  /*
   * Not a pasted diff: a pasted one gets truncated and leaves the reviewer unable to see the caller of a
   * changed function. Fetching it costs less context and buys whole-file reads.
   */
  assert.match(prompt, /git diff abc123abc123abc123/);
  assert.match(prompt, /git diff --stat abc123abc123abc123/);
  // Untracked files are in no diff against a commit, so they have to be named or they are never reviewed.
  assert.match(prompt, /client\/new\//);
  assert.match(prompt, /NOT in that diff/);
  // And the shape of the answer is specified, because that is what the model is worse at than a schema.
  assert.match(prompt, /"severity"/);
  assert.match(prompt, /Do not invent something to say/);
});

test('a review cannot edit the tree it is judging', () => {
  const chat = reviewChat({ id: 'p', name: 'n', path: 'C:/repos/app', createdAt: '', defaultPermissionMode: 'acceptEdits' } as never, undefined);
  // plan mode is a guarantee from the CLI rather than a line in a prompt asking it nicely.
  assert.equal(chat.permissionMode, 'plan');
  // Ephemeral: a review is not a conversation, and twenty of them would bury the chats in the sidebar.
  assert.match(chat.id, /^review:p:/);
  assert.equal(chat.lastMessageAt, null);
});

test('the review is refused when there is nothing to review', () => {
  const route = readFileSync('server/routes/review.ts', 'utf8');
  // A run against an empty diff costs real tokens to be told nothing.
  assert.match(route, /if \(context\.reason\) return badRequest\(reply, context\.reason, 'NOTHING_TO_REVIEW'\)/);
});

test('a review spends quota, so it is accounted for like any other run', () => {
  const route = readFileSync('server/routes/review.ts', 'utf8');
  assert.match(route, /usage\.append\(/);
  // Recorded even if the tab has gone: the run happened.
  assert.match(route, /if \(!clientGone\) send\(event\)/);
  // The quota window is kept, which the first version dropped — the usage view needs it after a reload.
  assert.match(route, /event\.type === 'rate_limit'/);
  // And the cap a chat turn obeys applies here too.
  assert.match(route, /settings\?\.maxTurns \?\? 0/);
});

test('the base is the branch this project raises pull requests against', () => {
  const source = readFileSync('server/review.ts', 'utf8');
  /*
   * The remembered fast-forward ref first: on this machine that is `origin/dev`, which no default-branch
   * guess would have produced — pull requests here go to dev and main only ever fast-forwards.
   */
  assert.match(source, /if \(preferred\) candidates\.push\(preferred\)/);
  const route = readFileSync('server/routes/review.ts', 'utf8');
  assert.match(route, /project\.fastForwardRef \?\? null/);
  // A merge base, not the tip: comparing against the tip attributes every commit the base gained to you.
  assert.match(source, /'merge-base', 'HEAD', baseRef/);
});

const result = (overrides: Partial<ReviewResult> = {}): ReviewResult => ({
  projectId: 'p',
  pull: null,
  base: 'origin/dev',
  branch: 'feature-x',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  summary: 'A summary.',
  findings: [],
  raw: '',
  parsed: true,
  costUsd: 0.42,
  error: null,
  ...overrides
});

test('an unparsed reply is shown verbatim rather than as a clean review', () => {
  const list = readFileSync('client/features/review/FindingList.tsx', 'utf8');
  assert.match(list, /could not be read as findings/);
  assert.match(list, /!result\.parsed && result\.raw/);
  // And the promise that matters is said before the button is pressed, not buried in a doc.
  const panel = readFileSync('client/features/review/BranchReview.tsx', 'utf8');
  assert.match(panel, /It cannot edit anything — the run is in the CLI's plan mode/);
  assert.ok(result().parsed);
});

test('review is offered without gh, and only the pull-request half is gated', () => {
  const page = readFileSync('client/features/pr/PrPage.tsx', 'utf8');
  /*
   * Reviewing a branch needs git and the agent, so it works for a project whose remote is not GitHub and for
   * one with no remote at all. Gating both halves would have withheld the useful one for no reason.
   */
  const reviewAt = page.indexOf('<BranchReview');
  const gateAt = page.indexOf('<ToolGate');
  assert.ok(reviewAt > 0 && gateAt > 0, 'both are on the page');
  assert.ok(reviewAt < gateAt, 'review comes first and sits outside the gate');
});

test('progress says what it is doing, because a review takes minutes', () => {
  const stream = readFileSync('client/features/review/stream.ts', 'utf8');
  // A bare spinner for three minutes reads as a hang; "17 files read" reads as a review being thorough.
  assert.match(stream, /filesRead/);
  assert.match(stream, /Reading \$\{path\.split/);
  const hook = readFileSync('client/features/review/useReview.ts', 'utf8');
  // Switching project must not leave the previous project's review on screen.
  assert.match(hook, /\}, \[projectId\]\);/);
});

test('a finding renders its file and line, and hides its reasoning until asked', () => {
  const finding = parseReview(GOOD).findings[0] as ReviewFinding;
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <FindingRow finding={finding} />
    </Tooltip.Provider>
  );
  assert.match(html, /server\/routes\/review\.ts:75/);
  assert.match(html, /Writes to the socket/);
  // Collapsed by default: twelve findings should be scannable in one screen.
  assert.ok(!/every send throws/.test(html), 'the reasoning is behind a press');
});

test('severity is carried by more than colour', () => {
  const html = (severity: ReviewFinding['severity']) =>
    renderToStaticMarkup(
      <Tooltip.Provider>
        <FindingRow finding={{ file: 'a.ts', line: 1, severity, title: 't', detail: 'd' }} />
      </Tooltip.Provider>
    );
  // Each severity gets its own icon as well as its own border, so the list still reads without colour.
  const high = html('high');
  const low = html('low');
  assert.notEqual(high, low);
  assert.match(high, /border-danger/);
});
