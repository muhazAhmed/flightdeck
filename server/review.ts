/**
 * Reviewing a change before it becomes a pull request.
 *
 * WHY LOCAL AND NOT VIA GITHUB. The moment a review is worth having is *before* you raise the PR, while
 * acting on it is still free — and at that moment the change may not be pushed, may not be committed, and the
 * repository may not be on GitHub at all. So this needs git and the agent, nothing else: it works for every
 * project you have imported, including one with no remote.
 *
 * THE DIFF IS NOT PASTED INTO THE PROMPT. The agent is told the base commit and runs `git diff` itself, which
 * costs less context than a pasted diff and lets it read whole files around anything it is unsure about. A
 * reviewer that cannot see the caller of a changed function is guessing, and guesses are what make a review
 * worth ignoring.
 *
 * The findings come back as one JSON block rather than prose, so they render as a list you can act on
 * item by item. `parseReview` is pure and tested, because a model that decorates its output slightly
 * differently must degrade to "here is what it said" rather than to an empty screen.
 */
import { randomUUID } from 'node:crypto';
import type { Chat, Project, ReviewContext, ReviewFinding, ReviewResult } from '@shared/types';
import { runGit } from './git-exec.js';
import { readStatus } from './routes/status.js';

/** A review reads a repository; it must never wait on one forever. */
const GIT_TIMEOUT_MS = 5000;

/**
 * The line separator for a built prompt.
 *
 * From its code point, like `ENTER` in the terminal hook: a literal newline inside a `join('…')` is invisible in
 * source and the first tool to normalise line endings turns it into something else or eats it. This file has
 * already been bitten once.
 */
const NEWLINE = String.fromCharCode(10);

/** Trunk names to fall back on when the remote never told us which is the default. */
const LIKELY_TRUNKS = ['origin/dev', 'origin/develop', 'origin/main', 'origin/master'];

/** Long enough for a real title; short enough that the list stays scannable. */
const MAX_TITLE = 120;
const MAX_DETAIL = 1000;
const MAX_FINDINGS = 50;

const SEVERITIES = ['high', 'medium', 'low'] as const;
type Severity = (typeof SEVERITIES)[number];

/**
 * The base to compare against.
 *
 * The project's remembered fast-forward ref comes first, because that is the branch its pull requests are
 * actually raised against — on this machine `origin/dev`, which is not what a default-branch guess would
 * have produced. Then `origin/HEAD`, then the usual names, and only refs that really exist are considered.
 */
async function resolveBase(cwd: string, preferred: string | null): Promise<string | null> {
  const candidates: string[] = [];
  if (preferred) candidates.push(preferred);

  const head = await runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], GIT_TIMEOUT_MS);
  if (head.ok) {
    const name = head.stdout.trim();
    if (name) candidates.push(name);
  }
  candidates.push(...LIKELY_TRUNKS);

  for (const ref of candidates) {
    const exists = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], GIT_TIMEOUT_MS);
    if (exists.ok && exists.stdout.trim()) return ref;
  }
  return null;
}

/**
 * What there is to review, and whether there is anything at all.
 *
 * The merge base rather than the tip of the base branch: comparing against the tip would show every commit
 * the base has gained since you branched as though you had written it.
 */
export async function resolveContext(project: Project, preferredBase: string | null): Promise<ReviewContext> {
  const cwd = project.path;
  const status = await readStatus(cwd);
  const branch = status?.branch ?? null;
  const uncommitted = status ? status.staged.length + status.unstaged.length + status.untracked.length : 0;

  const baseRef = await resolveBase(cwd, preferredBase);
  if (!baseRef) {
    return {
      branch,
      baseRef: null,
      baseSha: null,
      commits: 0,
      changedFiles: 0,
      uncommitted,
      untracked: status?.untracked.map((file) => file.path).slice(0, 50) ?? [],
      // A repository with no remote branch to compare against is a real state, not an error: the working
      // tree can still be reviewed once something is changed in it.
      reason: uncommitted > 0 ? null : 'Nothing to compare against, and the working tree is clean.'
    };
  }

  const mergeBase = await runGit(cwd, ['merge-base', 'HEAD', baseRef], GIT_TIMEOUT_MS);
  const baseSha = mergeBase.ok ? mergeBase.stdout.trim() : null;
  if (!baseSha) {
    return {
      branch,
      baseRef,
      baseSha: null,
      commits: 0,
      changedFiles: 0,
      uncommitted,
      untracked: [],
      reason: `${baseRef} and this branch share no history.`
    };
  }

  const [commits, names] = await Promise.all([
    runGit(cwd, ['rev-list', '--count', `${baseSha}..HEAD`], GIT_TIMEOUT_MS),
    // Working tree against the base, so uncommitted work counts too — that is the state you are about to
    // raise a pull request from, whether or not you have committed it yet.
    runGit(cwd, ['diff', '--name-only', baseSha], GIT_TIMEOUT_MS)
  ]);

  const changedFiles = names.ok ? names.stdout.split(/\r?\n/).filter(Boolean).length : 0;
  const untracked = status?.untracked.map((file) => file.path).slice(0, 50) ?? [];

  return {
    branch,
    baseRef,
    baseSha,
    commits: commits.ok ? Number.parseInt(commits.stdout.trim(), 10) || 0 : 0,
    changedFiles,
    uncommitted,
    untracked,
    reason:
      changedFiles === 0 && untracked.length === 0
        ? `Nothing differs from ${baseRef}.`
        : null
  };
}

/**
 * What the agent is asked to do.
 *
 * Deliberately short on instructions about *how* to review and specific about the shape of the answer: the
 * model is better at the first than any prompt of mine, and worse at the second than a schema.
 */
export function buildPrompt(context: ReviewContext): string {
  const lines = [
    'Review this change the way a careful colleague would before it becomes a pull request.',
    '',
    `Base: ${context.baseRef ?? 'none'}${context.baseSha ? ` (${context.baseSha.slice(0, 12)})` : ''}`,
    `Branch: ${context.branch ?? 'detached'} — ${context.commits} commit(s) ahead, ${context.uncommitted} file(s) with uncommitted changes`,
    '',
    'Read the change yourself:',
    context.baseSha ? `  git diff --stat ${context.baseSha}` : '  git status --short',
    context.baseSha ? `  git diff ${context.baseSha}` : '  git diff',
    '',
    'Read whole files around anything you are unsure about. A review that cannot see the caller of a changed function is guessing.'
  ];

  if (context.untracked.length > 0) {
    lines.push(
      '',
      'These files are new and are NOT in that diff — read them directly (git collapses a new directory to its name, so some may be directories):',
      ...context.untracked.map((file) => `  ${file}`)
    );
  }

  lines.push(
    '',
    'Report only what a reviewer would actually raise: a bug, a case the code does not handle, data that can be lost, a security problem, an API used wrongly, a test that cannot fail. Do not report formatting or naming preferences, and do not restate what the change does.',
    '',
    'End your reply with one fenced json block and nothing after it:',
    '',
    '```json',
    '{"summary":"one sentence about the change as a whole","findings":[{"file":"relative/path.ts","line":42,"severity":"high","title":"short claim","detail":"what breaks, and when"}]}',
    '```',
    '',
    '`file` is relative to the repository root. `line` is the line number in the file as it stands now, or null if it does not belong to one line. `severity` is high, medium or low.',
    'If the change is sound, return an empty findings array. Do not invent something to say.'
  );

  return lines.join('\n');
}

/** The last fenced block, since a reply may show an example before it gives its answer. */
function lastJsonBlock(text: string): string | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  let found: string | null = null;
  for (let match = fence.exec(text); match !== null; match = fence.exec(text)) {
    const body = match[1]?.trim();
    if (body && body.startsWith('{')) found = body;
  }
  return found;
}

function asSeverity(value: unknown): Severity {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : 'medium';
}

function asLine(value: unknown): number | null {
  const line = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(line) && line > 0 ? line : null;
}

function clamp(value: unknown, limit: number): string {
  return String(value ?? '').trim().slice(0, limit);
}

/**
 * Read the findings out of a reply.
 *
 * Tolerant on purpose. A model that wraps its block differently, adds a sentence after it, or returns a
 * finding without a line number must degrade to "here is what it said" — never to an empty screen that looks
 * like a clean review. `raw` is always kept for exactly that reason.
 */
export function parseReview(text: string): { summary: string | null; findings: ReviewFinding[]; parsed: boolean } {
  const block = lastJsonBlock(text);
  if (!block) return { summary: null, findings: [], parsed: false };

  let data: unknown;
  try {
    data = JSON.parse(block);
  } catch {
    return { summary: null, findings: [], parsed: false };
  }

  if (typeof data !== 'object' || data === null) return { summary: null, findings: [], parsed: false };
  const record = data as { summary?: unknown; findings?: unknown };
  const raw = Array.isArray(record.findings) ? record.findings : [];

  const findings: ReviewFinding[] = [];
  for (const entry of raw.slice(0, MAX_FINDINGS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const title = clamp(item.title, MAX_TITLE);
    // Windows-style separators would not match anything the diff view knows about.
    const file = clamp(item.file, 300).replace(/\\/g, '/');
    /*
     * A finding with nothing to say is noise; one with no file cannot be found. Both are dropped — which is
     * what this comment claimed before the first review of this very module pointed out that the code only
     * checked the title.
     */
    if (title === '' || file === '') continue;
    findings.push({
      file,
      line: asLine(item.line),
      severity: asSeverity(item.severity),
      title,
      detail: clamp(item.detail, MAX_DETAIL)
    });
  }

  const summary = clamp(record.summary, 500);
  return { summary: summary === '' ? null : summary, findings, parsed: true };
}

/** Severity first, then file, so the list reads worst-first without hiding where things are. */
export function rank(findings: ReviewFinding[]): ReviewFinding[] {
  const weight: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return [...findings].sort(
    (a, b) => weight[a.severity as Severity] - weight[b.severity as Severity] || a.file.localeCompare(b.file)
  );
}

/**
 * The run itself is an ordinary agent run with an ephemeral chat.
 *
 * Not persisted as a chat: a review is not a conversation, and twenty of them in the sidebar would bury the
 * chats that are. It still spends quota, so the caller records usage exactly as a chat turn does.
 *
 * `plan` mode, because a reviewer has no business editing the tree it is reviewing. That is a guarantee from
 * the CLI rather than a line in a prompt.
 */
export function reviewChat(project: Project, model: string | undefined): Chat {
  return {
    id: `review:${project.id}:${randomUUID()}`,
    projectId: project.id,
    parentChatId: null,
    title: 'Review',
    sessionId: randomUUID(),
    permissionMode: 'plan',
    model,
    createdAt: new Date().toISOString(),
    lastMessageAt: null
  };
}

/**
 * In memory only, keyed by what was reviewed.
 *
 * A branch review and a review of pull request 152 are different answers about the same project, so the key
 * carries both. Not persisted: a review describes a tree as it was, and a stale one presented as current is
 * worse than none.
 */
const results = new Map<string, ReviewResult>();

/** `<projectId>` for a branch, `<projectId>:pr:<number>` for a pull request. */
export function keyFor(projectId: string, pull: number | null): string {
  return pull === null ? projectId : `${projectId}:pr:${pull}`;
}

export function remember(result: ReviewResult): void {
  results.set(keyFor(result.projectId, result.pull), result);
}

export function lastFor(projectId: string, pull: number | null = null): ReviewResult | null {
  return results.get(keyFor(projectId, pull)) ?? null;
}

export function forget(projectId: string, pull: number | null = null): void {
  results.delete(keyFor(projectId, pull));
}

/**
 * What the agent is asked when the change is someone else's pull request.
 *
 * The same shape of answer as a branch review, and deliberately the same tolerant parser — but a different
 * frame: this is code arriving from outside, which is where a reviewer earns its keep. The pull request's
 * commit is a real ref in the repository by the time this runs, so the agent reads whole files at *its*
 * revision rather than at yours; a file the pull request changed looks nothing like your copy of it.
 */
export function buildPullPrompt(options: {
  number: number;
  title: string;
  author: string;
  base: string;
  ref: string;
  mergeBase: string;
  files: string[];
}): string {
  const lines = [
    `Review pull request #${options.number} — "${options.title}" by ${options.author} — as a careful reviewer would before approving it.`,
    '',
    `It targets ${options.base}. Its commit is fetched locally as ${options.ref}; nothing is checked out, and you must not change the working tree.`,
    '',
    'Read it yourself:',
    `  git diff --stat ${options.mergeBase} ${options.ref}`,
    `  git diff ${options.mergeBase} ${options.ref}`,
    '',
    `Read whole files at the pull request's own revision with \`git show ${options.ref}:<path>\` — your working copy of a file it changed is a different file, and reviewing against the wrong one produces confident nonsense.`
  ];

  if (options.files.length > 0) {
    lines.push('', 'Files it touches:', ...options.files.slice(0, 100).map((file) => `  ${file}`));
  }

  lines.push(
    '',
    'Report only what you would raise in a review: a bug, a case it does not handle, data that can be lost, a security problem, an API used wrongly, a test that cannot fail, something that will break for the people who already depend on this code. Do not report formatting or naming preferences, and do not summarise the change back.',
    '',
    'End your reply with one fenced json block and nothing after it:',
    '',
    '```json',
    '{"summary":"one sentence on whether this is safe to merge and why","findings":[{"file":"relative/path.ts","line":42,"severity":"high","title":"short claim","detail":"what breaks, and when"}]}',
    '```',
    '',
    '`file` is relative to the repository root. `line` is the line number in the file as the pull request leaves it, or null. `severity` is high, medium or low.',
    'If it is sound, return an empty findings array. Do not invent something to say.'
  );

  return lines.join(NEWLINE);
}
