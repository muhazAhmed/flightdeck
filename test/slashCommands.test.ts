import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandsFor } from '../server/commands.ts';
import { filterCommands, slashQuery } from '../client/features/chat/SlashMenu.tsx';

/**
 * Slash commands and skills.
 *
 * The feature was only built after confirming the CLI runs them headless: a `.claude/commands/hello.md` saying
 * "reply with exactly SLASHWORKS" returned `SLASHWORKS` through `claude -p`. Autocomplete for something that
 * silently did nothing would be worse than none.
 *
 * (That check also surfaced a Git Bash trap: `claude -p "/hello"` from a bash prompt has the argument
 * path-translated to `E:/muhaz/Git/hello` before the CLI sees it. Flight Deck sends prompts as JSON on stdin,
 * so it is immune — but it is why the first attempt looked like slash commands did not work.)
 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-commands-'));
  mkdirSync(join(dir, '.claude', 'commands'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
  return dir;
}

function command(dir: string, relativePath: string, contents: string): void {
  const path = join(dir, '.claude', 'commands', relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

test('a command is found with its description and argument hint', () => {
  const dir = project();
  try {
    command(dir, 'deploy.md', '---\ndescription: Ship it\nargument-hint: [env]\n---\nDo the deploy.\n');
    const found = commandsFor(dir).find((entry) => entry.name === 'deploy');
    assert.ok(found);
    assert.equal(found.description, 'Ship it');
    assert.equal(found.argumentHint, '[env]');
    assert.equal(found.source, 'project');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a subdirectory namespaces with a colon, as the CLI does', () => {
  const dir = project();
  try {
    command(dir, join('git', 'sync.md'), '---\ndescription: Sync\n---\nbody\n');
    assert.ok(commandsFor(dir).some((entry) => entry.name === 'git:sync'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a command without frontmatter still works, described by its first line', () => {
  const dir = project();
  try {
    command(dir, 'plain.md', '# Heading\n\nRun the tests and report failures.\n');
    const found = commandsFor(dir).find((entry) => entry.name === 'plain');
    assert.ok(found);
    // The heading is skipped: it names the file, it does not describe the action.
    assert.equal(found.description, 'Run the tests and report failures.');
    assert.equal(found.argumentHint, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quoted frontmatter values are unquoted', () => {
  const dir = project();
  try {
    command(dir, 'quoted.md', `---\ndescription: "Ship it, carefully"\n---\nbody\n`);
    assert.equal(commandsFor(dir).find((e) => e.name === 'quoted')?.description, 'Ship it, carefully');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a skill is listed as a skill, named by its directory', () => {
  const dir = project();
  try {
    const skill = join(dir, '.claude', 'skills', 'pdf-tools');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\ndescription: Work with PDFs\n---\nbody\n', 'utf8');

    const found = commandsFor(dir).find((entry) => entry.name === 'pdf-tools');
    assert.ok(found);
    assert.equal(found.kind, 'skill');
    assert.equal(found.description, 'Work with PDFs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory without SKILL.md is not a skill', () => {
  const dir = project();
  try {
    mkdirSync(join(dir, '.claude', 'skills', 'not-a-skill'), { recursive: true });
    assert.ok(!commandsFor(dir).some((entry) => entry.name === 'not-a-skill'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a project with no .claude directory reports nothing rather than failing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flightdeck-bare-'));
  try {
    // User-level commands may exist on the machine running this, so only the absence of a throw is asserted.
    assert.ok(Array.isArray(commandsFor(dir)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project commands come before user ones', () => {
  const dir = project();
  try {
    command(dir, 'zzz-last-alphabetically.md', '---\ndescription: x\n---\nbody\n');
    const found = commandsFor(dir);
    const firstUser = found.findIndex((entry) => entry.source === 'user');
    const projectEntry = found.findIndex((entry) => entry.name === 'zzz-last-alphabetically');
    // The repository's own commands are the ones being reached for, whatever they are called.
    if (firstUser !== -1) assert.ok(projectEntry < firstUser);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The trigger rule. */
test('only a leading slash on the first token opens the menu', () => {
  assert.equal(slashQuery('/'), '');
  assert.equal(slashQuery('/dep'), 'dep');
  assert.equal(slashQuery('/git:sync'), 'git:sync');

  // A space means the command is chosen and the rest is arguments.
  assert.equal(slashQuery('/deploy prod'), null);
  // A slash mid-sentence is a path, a fraction or a regex — never a command.
  assert.equal(slashQuery('look at src/main.ts'), null);
  assert.equal(slashQuery('and/or'), null);
  assert.equal(slashQuery(''), null);
  assert.equal(slashQuery('deploy'), null);
});

test('prefix matches rank above substring matches', () => {
  const commands = [
    { name: 'redeploy', source: 'user' as const, description: '', path: '' },
    { name: 'deploy', source: 'project' as const, description: '', path: '' }
  ];
  // `/dep` should offer `deploy` before `redeploy`, whatever order they arrived in.
  assert.deepEqual(filterCommands(commands, 'dep').map((c) => c.name), ['deploy', 'redeploy']);
  assert.equal(filterCommands(commands, '').length, 2);
  assert.equal(filterCommands(commands, 'nothing').length, 0);
});

test('matching ignores case', () => {
  const commands = [{ name: 'Deploy', source: 'project' as const, description: '', path: '' }];
  assert.equal(filterCommands(commands, 'dep').length, 1);
});

/** The interaction that a naive implementation gets wrong. */
test('Enter completes the command instead of sending while the menu is open', () => {
  const source = readFileSync('client/features/chat/PromptInput.tsx', 'utf8');
  const handler = source.slice(source.indexOf('function onKeyDown'));
  const body = handler.slice(0, handler.indexOf('\n  const busy'));

  // Now that Enter sends, an unguarded Enter would fire `/dep` as a prompt rather than completing it.
  assert.ok(body.indexOf('if (slashOpen)') < body.indexOf("if (event.key !== 'Enter') return;"));
  assert.match(body, /event\.key === 'Enter' \|\| event\.key === 'Tab'/);
  assert.match(body, /ArrowDown/);
  assert.match(body, /ArrowUp/);
});

test('Escape dismisses only until the next slash is typed', () => {
  const source = readFileSync('client/features/chat/PromptInput.tsx', 'utf8');
  assert.match(source, /if \(slashQuery\(next\) === ''\) setSlashDismissed\(false\)/);
});

test('the menu opens upward, because the input sits at the bottom of the window', () => {
  const menu = readFileSync('client/features/chat/SlashMenu.tsx', 'utf8');
  assert.match(menu, /bottom-full/);
  // A click handler would fire after the textarea's blur had already closed the menu.
  assert.match(menu, /onMouseDown/);
  assert.ok(!/onClick=/.test(menu), 'picking must happen on mousedown');
});
