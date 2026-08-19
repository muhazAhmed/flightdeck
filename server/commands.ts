/**
 * Slash commands and skills available to a project.
 *
 * VERIFIED FIRST, BUILT SECOND. Before any of this existed, a custom command was run through the real CLI in
 * `-p` mode to confirm they work headless at all: a `.claude/commands/hello.md` containing "reply with exactly
 * SLASHWORKS" returned `SLASHWORKS`. Autocomplete for something that silently did nothing would be worse than
 * no autocomplete.
 *
 * Read from disk rather than asked of the CLI, because there is no headless route that lists them. That means
 * this file encodes the CLI's layout conventions, so it is written to fail quietly: a directory that is not
 * there contributes nothing, and a file without frontmatter still becomes a command with no description.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { SlashCommand } from '@shared/types';

/** Deep enough for the namespacing people actually use; not deep enough to walk a stray node_modules. */
const MAX_DEPTH = 3;

/** A command definition is prose with frontmatter; anything larger is not one. */
const MAX_BYTES = 256 * 1024;

function claudeDir(root: string): string {
  return join(root, '.claude');
}

/**
 * Minimal frontmatter reader: `key: value` lines between the leading `---` fences.
 *
 * Not a YAML parser, and deliberately so — the only fields read are `description` and `argument-hint`, both of
 * which are single-line scalars. Quotes are stripped because both styles appear in the wild.
 */
function frontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};

  const fields: Record<string, string> = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key) fields[key] = value;
  }
  return fields;
}

/** The body after the frontmatter, used only to describe a command that did not describe itself. */
function body(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text : text.slice(end + 4);
}

function readMarkdown(path: string): { fields: Record<string, string>; body: string } | null {
  try {
    if (statSync(path).size > MAX_BYTES) return null;
    const text = readFileSync(path, 'utf8');
    return { fields: frontmatter(text), body: body(text) };
  } catch {
    return null;
  }
}

/** First sentence of the body, for a command whose frontmatter has no description. */
function firstLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith('#'));
  if (!line) return '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * Every `.md` under a commands directory.
 *
 * Subdirectories namespace a command with a colon — `commands/git/sync.md` is `/git:sync` — which is the CLI's
 * own convention, not ours.
 */
function walkCommands(root: string, source: SlashCommand['source'], out: SlashCommand[]): void {
  if (!existsSync(root)) return;

  const visit = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) visit(path, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;

      const parsed = readMarkdown(path);
      if (!parsed) continue;

      const name = relative(root, path).replace(/\.md$/, '').split(sep).join(':');
      out.push({
        name,
        source,
        description: parsed.fields.description || firstLine(parsed.body),
        argumentHint: parsed.fields['argument-hint'] || undefined,
        path
      });
    }
  };

  visit(root, 0);
}

/**
 * Skills, which a user invokes the same way as a command.
 *
 * A skill is a directory holding `SKILL.md`, so the directory name is the invocation and the frontmatter inside
 * describes it.
 */
function walkSkills(root: string, source: SlashCommand['source'], out: SlashCommand[]): void {
  if (!existsSync(root)) return;

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, 'SKILL.md');
    const parsed = readMarkdown(path);
    if (!parsed) continue;
    out.push({
      name: parsed.fields.name || entry.name,
      source,
      kind: 'skill',
      description: parsed.fields.description || firstLine(parsed.body),
      path
    });
  }
}

/**
 * Commands and skills for one project.
 *
 * Project definitions win over user-level ones of the same name, which is the CLI's own precedence: a repository
 * that ships a `/deploy` means its own `/deploy`.
 */
export function commandsFor(projectPath: string): SlashCommand[] {
  const found: SlashCommand[] = [];

  walkCommands(join(claudeDir(projectPath), 'commands'), 'project', found);
  walkSkills(join(claudeDir(projectPath), 'skills'), 'project', found);
  walkCommands(join(claudeDir(homedir()), 'commands'), 'user', found);
  walkSkills(join(claudeDir(homedir()), 'skills'), 'user', found);

  const seen = new Set<string>();
  return found
    .filter((command) => {
      const key = `${command.kind ?? 'command'}:${command.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      // Project before user, then alphabetical: the repository's own commands are the ones being reached for.
      if (a.source !== b.source) return a.source === 'project' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
