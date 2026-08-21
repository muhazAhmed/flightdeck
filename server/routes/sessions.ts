/**
 * Discovering and importing Claude Code sessions that Flight Deck did not create.
 *
 * The CLI writes one JSONL transcript per session under
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, whoever started it — this app, the
 * IDE extension, or a bare terminal. Since history replay already reads that format, adopting
 * an existing session costs almost nothing: record its id as a chat and the transcript renders
 * like any other.
 *
 * Nothing here is machine-specific: the location is derived from `homedir()` and the project's
 * own path, so it works for anyone who clones this. The layout itself is undocumented, read
 * off disk — so every failure degrades to "no sessions found" rather than an error.
 *
 * ONE REAL LIMITATION, surfaced rather than hidden: two clients cannot safely write to one
 * session. A transcript touched moments ago is probably open somewhere else, so it is flagged
 * as active and the UI warns before you continue it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Chat, DiscoveredSession } from '@shared/types';
import { resolveTranscriptDir } from '../platform.js';
import * as state from '../state.js';
import { badRequest, notFound } from '../errors.js';

/** How recently a transcript must have changed to be treated as "probably open elsewhere".
 *  A heuristic, and labelled as one in the UI — there is no reliable liveness signal. */
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;

/** Enough of the file to find the opening prompt. A long session is megabytes; reading all of
 *  it just to preview one line would make the list crawl. */
const PREVIEW_BYTES = 96 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The transcript records slash commands, hook output and system reminders as user messages.
 *  None of those is what the human typed, so they make a useless preview. */
function isSynthetic(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed.startsWith('<') || trimmed.startsWith('Caveat: The messages below');
}

function firstPromptOf(path: string): string | null {
  let head: string;
  try {
    const handle = readFileSync(path, 'utf8');
    head = handle.length > PREVIEW_BYTES ? handle.slice(0, PREVIEW_BYTES) : handle;
  } catch {
    return null;
  }

  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      // The slice can cut the final line in half; that is expected, not a failure.
      continue;
    }
    if (!isRecord(record) || record.type !== 'user' || record.isSidechain === true) continue;
    const message = isRecord(record.message) ? record.message : null;
    const content = message?.content;

    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((b): b is Record<string, unknown> => isRecord(b) && b.type === 'text')
              .map((b) => String(b.text ?? ''))
              .join('')
          : '';

    if (text && !isSynthetic(text)) return text.slice(0, 200);
  }
  return null;
}

function discover(projectPath: string, importedSessionIds: Set<string>): DiscoveredSession[] {
  const dir = resolveTranscriptDir(projectPath);
  if (!existsSync(dir)) return [];

  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const now = Date.now();
  const sessions: DiscoveredSession[] = [];

  for (const name of names) {
    const sessionId = name.slice(0, -'.jsonl'.length);
    if (importedSessionIds.has(sessionId)) continue;

    const path = join(dir, name);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }

    sessions.push({
      sessionId,
      firstPrompt: firstPromptOf(path),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      active: now - stats.mtimeMs < ACTIVE_WINDOW_MS
    });
  }

  // Most recent first: the session someone wants to pick up is nearly always the last one
  // they were in.
  sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return sessions;
}

/** A title from the opening prompt — short enough for the sidebar, whole words where it can. */
function titleFrom(prompt: string | null, sessionId: string): string {
  if (!prompt) return `Session ${sessionId.slice(0, 8)}`;
  const flat = prompt.replace(/\s+/g, ' ').trim();
  if (flat.length <= 48) return flat;
  const cut = flat.slice(0, 48);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 24 ? cut.slice(0, lastSpace) : cut}…`;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>('/api/sessions/discoverable', async (req, reply) => {
    const project = req.query.projectId ? state.findProject(req.query.projectId) : undefined;
    if (!project) return notFound(reply, 'No such project.');
    const imported = new Set(state.read().chats.map((c) => c.sessionId));
    return discover(project.path, imported);
  });

  app.post<{ Body: { projectId?: string; sessionId?: string; title?: string } }>(
    '/api/sessions/import',
    async (req, reply) => {
      const { projectId, sessionId, title } = req.body ?? {};
      const project = projectId ? state.findProject(projectId) : undefined;
      if (!project) return notFound(reply, 'No such project.');
      if (!sessionId) return badRequest(reply, 'A sessionId is required.');

      const already = state.read().chats.find((c) => c.sessionId === sessionId);
      if (already) return badRequest(reply, `Already imported as "${already.title}".`, 'ALREADY_IMPORTED');

      const path = join(resolveTranscriptDir(project.path), `${sessionId}.jsonl`);
      if (!existsSync(path)) {
        return badRequest(reply, 'No transcript for that session in this project.', 'NO_TRANSCRIPT');
      }

      const stats = statSync(path);
      const prompt = firstPromptOf(path);

      return state.update((s) => {
        const chat: Chat = {
          id: crypto.randomUUID(),
          projectId: project.id,
          parentChatId: null,
          title: title?.trim() || titleFrom(prompt, sessionId),
          // The existing id — this is the whole point. It also means the chat is already
          // "used", so the next message resumes rather than trying to claim the id.
          sessionId,
          permissionMode: project.defaultPermissionMode,
          createdAt: new Date().toISOString(),
          lastMessageAt: stats.mtime.toISOString()
        };
        s.chats.push(chat);
        return chat;
      });
    }
  );
}
