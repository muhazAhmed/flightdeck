import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Chat, PermissionMode, UiEvent } from '@shared/types';
import * as agent from '../agent.js';
import * as state from '../state.js';
import { readTranscript } from '../transcript.js';
import { badRequest, notFound } from '../errors.js';

const PERMISSION_MODES: PermissionMode[] = ['acceptEdits', 'plan', 'bypassPermissions'];

/** Server-sent events, written by hand rather than via a plugin: the framing is three
 *  lines and doing it here keeps the flush behaviour explicit and inspectable. */
function openStream(reply: FastifyReply): (event: UiEvent) => void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nothing between us and the browser should buffer this.
    'X-Accel-Buffering': 'no'
  });
  return (event: UiEvent) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>('/api/chats', async (req) => {
    const chats = state.read().chats;
    const projectId = req.query.projectId;
    return projectId ? chats.filter((c) => c.projectId === projectId) : chats;
  });

  app.get('/api/chats/running', async () => agent.runningChats());

  app.get<{ Params: { id: string } }>('/api/chats/:id/history', async (req, reply) => {
    const chat = state.findChat(req.params.id);
    if (!chat) return notFound(reply, 'No such chat.');
    const project = state.findProject(chat.projectId);
    if (!project) return notFound(reply, 'This chat points at a project that no longer exists.');
    // An absent transcript is a chat that has not run yet, not a failure.
    return readTranscript(project.path, chat.sessionId);
  });

  app.post<{
    Body: { projectId?: string; title?: string; parentChatId?: string | null; permissionMode?: PermissionMode };
  }>('/api/chats', async (req, reply) => {
    const { projectId, title, parentChatId, permissionMode } = req.body ?? {};
    if (!projectId) return badRequest(reply, 'A projectId is required.');
    const project = state.findProject(projectId);
    if (!project) return notFound(reply, 'No such project.');
    if (permissionMode && !PERMISSION_MODES.includes(permissionMode)) {
      return badRequest(reply, `Unknown permission mode: ${permissionMode}`);
    }
    if (parentChatId && !state.findChat(parentChatId)) {
      return badRequest(reply, 'The parent chat no longer exists.');
    }

    return state.update((s) => {
      const chat: Chat = {
        id: randomUUID(),
        projectId,
        parentChatId: parentChatId ?? null,
        title: title?.trim() || 'New chat',
        // The CLI requires a real UUID here, and it doubles as the transcript's identity.
        sessionId: randomUUID(),
        permissionMode: permissionMode ?? project.defaultPermissionMode,
        createdAt: new Date().toISOString(),
        lastMessageAt: null
      };
      s.chats.push(chat);
      return chat;
    });
  });

  app.patch<{ Params: { id: string }; Body: { title?: string; permissionMode?: PermissionMode } }>(
    '/api/chats/:id',
    async (req, reply) => {
      const { title, permissionMode } = req.body ?? {};
      if (permissionMode && !PERMISSION_MODES.includes(permissionMode)) {
        return badRequest(reply, `Unknown permission mode: ${permissionMode}`);
      }
      const updated = state.update((s) => {
        const chat = s.chats.find((c) => c.id === req.params.id);
        if (!chat) return null;
        if (title?.trim()) chat.title = title.trim();
        if (permissionMode) chat.permissionMode = permissionMode;
        return chat;
      });
      return updated ?? notFound(reply, 'No such chat.');
    }
  );

  app.delete<{ Params: { id: string } }>('/api/chats/:id', async (req, reply) => {
    if (!state.findChat(req.params.id)) return notFound(reply, 'No such chat.');
    await agent.abort(req.params.id);
    state.update((s) => {
      s.chats = s.chats.filter((c) => c.id !== req.params.id && c.parentChatId !== req.params.id);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/chats/:id/abort', async (req, reply) => {
    const stopped = await agent.abort(req.params.id);
    return stopped ? { ok: true } : notFound(reply, 'That chat is not running.');
  });

  app.post<{ Params: { id: string }; Body: { text?: string } }>('/api/chats/:id/message', async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) return badRequest(reply, 'A message is required.');

    const chat = state.findChat(req.params.id);
    if (!chat) return notFound(reply, 'No such chat.');
    const project = state.findProject(chat.projectId);
    if (!project) return notFound(reply, 'This chat points at a project that no longer exists.');
    if (agent.isRunning(chat.id)) return badRequest(reply, 'This chat is already running.', 'BUSY');

    // A session id can be claimed once; every later turn re-enters it with --resume.
    const resume = chat.lastMessageAt !== null;
    const send = openStream(reply);

    let clientGone = false;
    reply.raw.on('close', () => {
      clientGone = true;
      // A closed tab should not leave an agent running against a repo.
      void agent.abort(chat.id);
    });

    await agent.send(project, chat, text, resume, (event) => {
      if (!clientGone) send(event);
    });

    state.update((s) => {
      const stored = s.chats.find((c) => c.id === chat.id);
      if (stored) stored.lastMessageAt = new Date().toISOString();
    });

    if (!clientGone) reply.raw.end();
    return reply;
  });
}
