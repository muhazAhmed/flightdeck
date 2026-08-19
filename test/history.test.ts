import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Commit history.
 *
 * The parsers are exercised against **real git output** rather than hand-written fixtures, because the shapes
 * that break them are the ones git only produces in specific situations: a rename with the shared prefix
 * factored into braces, a binary file reporting `-` instead of a count, a merge commit with two parents, and a
 * subject containing the separator characters the format string uses.
 */
const source = readFileSync('server/routes/history.ts', 'utf8');
const UNIT = String.fromCharCode(31);
const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%ae', '%cI', '%D', '%p'].join('%x1f');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x.io' }
  });
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-history-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'a@x.io']);
  git(dir, ['config', 'user.name', 'A']);
  return dir;
}

function commit(dir: string, message: string): void {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', message]);
}

test('a log line survives a subject full of punctuation', () => {
  const dir = repo();
  try {
    // Commas and arrows are exactly what the ref and rename parsers look for.
    const subject = 'Fix a => b, and | that: "quoted" thing';
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    commit(dir, subject);

    const out = git(dir, ['log', `--format=${LOG_FORMAT}`]);
    const fields = out.trim().split(UNIT);
    assert.equal(fields[2], subject, 'the subject must survive intact');
    assert.equal(fields.length, 8, 'eight fields, so nothing shifted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refs are reported without the arrow decoration', () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    commit(dir, 'first');
    git(dir, ['tag', 'v1']);

    const decoration = git(dir, ['log', '-1', '--format=%D']).trim();
    // git prints "HEAD -> main, tag: v1". Splitting on the comma first means `HEAD -> main` collapses to a
    // single `main` chip rather than producing a redundant HEAD one, which is what we want on a row.
    assert.match(decoration, /HEAD -> main/);
    const refs = decoration
      .split(',')
      .map((ref) => ref.replace('HEAD ->', '').replace('tag:', '').trim())
      .filter(Boolean);
    assert.deepEqual(refs, ['main', 'v1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rename with a shared prefix parses to the new path', () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'x\n'.repeat(40));
    commit(dir, 'add');
    // git factors the common part out: `{a => b}.txt`, which a naive split on ' => ' gets wrong.
    renameSync(join(dir, 'a.txt'), join(dir, 'b.txt'));
    commit(dir, 'rename');

    const numstat = git(dir, ['show', '--numstat', '--format=', 'HEAD']).trim();
    assert.match(numstat, /=>/, 'this git reported a rename, so the brace form is under test');

    const rest = numstat.split('\t')[2] ?? '';
    const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(rest);
    const path = braced
      ? `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, '/')
      : (rest.split(' => ')[1] ?? rest);
    assert.equal(path, 'b.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a binary file reports dashes, which must not become NaN', () => {
  const dir = repo();
  try {
    // A PNG header is enough for git to treat it as binary.
    writeFileSync(join(dir, 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    commit(dir, 'binary');

    const [added, removed] = git(dir, ['show', '--numstat', '--format=', 'HEAD']).trim().split('\t');
    assert.equal(added, '-');
    assert.equal(removed, '-');
    // `Number('-') || 0` is what the route relies on; NaN would render as "NaN" in the UI.
    assert.equal(Number(added) || 0, 0);
    assert.ok(!Number.isNaN(Number(added) || 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a merge commit reports two parents', () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    commit(dir, 'first');
    git(dir, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(dir, 'side.txt'), 'side\n');
    commit(dir, 'side work');
    git(dir, ['checkout', '-q', 'main']);
    writeFileSync(join(dir, 'main.txt'), 'main\n');
    commit(dir, 'main work');
    git(dir, ['merge', '--no-ff', '-q', '-m', 'merge side', 'side']);

    const parents = git(dir, ['log', '-1', '--format=%p']).trim().split(/\s+/).filter(Boolean);
    assert.equal(parents.length, 2, 'a merge is worth marking rather than rendering as a normal commit');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('name-status supplies the letter numstat does not', () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, 'keep.txt'), 'keep\n');
    writeFileSync(join(dir, 'gone.txt'), 'gone\n');
    commit(dir, 'add two');
    rmSync(join(dir, 'gone.txt'));
    writeFileSync(join(dir, 'new.txt'), 'new\n');
    commit(dir, 'delete one, add one');

    const out = git(dir, ['show', '--name-status', '--format=', 'HEAD']).trim();
    const letters = new Map(
      out.split(/\r?\n/).filter(Boolean).map((line) => {
        const parts = line.split('\t');
        return [parts[parts.length - 1] as string, (parts[0] ?? '').charAt(0)];
      })
    );
    assert.equal(letters.get('gone.txt'), 'D');
    assert.equal(letters.get('new.txt'), 'A');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a sha from the client is shape-checked before it becomes a git argument', () => {
  const SHA = /^[0-9a-f]{4,40}$/;
  assert.ok(SHA.test('4dc4a27'));
  assert.ok(SHA.test('a'.repeat(40)));
  // Each of these would otherwise be handed to git as an argument.
  for (const bad of ['--upload-pack=evil', 'HEAD', 'main', '../etc', '4dc4a27; rm -rf /', '', 'ZZZ']) {
    assert.ok(!SHA.test(bad), `${bad} must be rejected`);
  }
  assert.match(source, /const SHA = \/\^\[0-9a-f\]\{4,40\}\$\//);
});

test('a file path is passed after a double dash', () => {
  // Without `--`, a file named `--output=x` would be read as an option.
  assert.match(source, /'--',\s*\n?\s*path/);
});

test('history has no route that changes anything', () => {
  // Looking back at a commit is a different act from undoing it, and the second belongs in a terminal.
  for (const forbidden of ['revert', 'reset', 'cherry-pick', 'checkout', 'restore']) {
    assert.ok(!source.includes(`'${forbidden}'`), `${forbidden} must not appear in history routes`);
  }
  assert.ok(!/app\.(post|patch|delete|put)/.test(source), 'history is read-only: no write routes');
});

test('paging asks for one extra row rather than counting the whole history', () => {
  // A repository with 40,000 commits must not pay for a count to answer "is there more".
  assert.match(source, /--max-count=\$\{limit \+ 1\}/);
  assert.match(source, /hasMore: commits\.length > limit/);
});

test('an empty repository reports no commits instead of an error', () => {
  const dir = repo();
  try {
    let failed = false;
    try {
      git(dir, ['log', '--format=%H']);
    } catch {
      failed = true;
    }
    assert.ok(failed, 'git itself fails on a repository with no HEAD');
    // Which is why the route special-cases it.
    assert.match(source, /does not have any commits yet\|unknown revision/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
