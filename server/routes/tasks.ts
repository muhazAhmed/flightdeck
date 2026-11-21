/**
 * Workflow tasks: create, watch, follow up, stop, delete — and each project's workflow configuration.
 *
 * The project is always resolved from an id (CLAUDE.md rule 5); no path arrives from the client.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { MODEL_OPTIONS, type UiEvent } from '@shared/types';
import type { ProjectWorkflowConfig, Task, TaskSummary } from '@shared/workflow';
import * as state from '../state.js';
import * as tasks from '../tasks.js';
import { badRequest, notFound } from '../errors.js';
import { configFor, isSafeCommand, writeNotes } from '../workflow.js';

/** Long enough for a real brief, short enough that a pasted log file is refused rather than sent. */
const MAX_DESCRIPTION = 20_000;
/** Notes are read by the lead at the start of every task, so their size is paid for every time. */
const MAX_NOTES = 40_000;
const TITLE_LENGTH = 80;

function titleFrom(description: string): string {
  const first = description.split('\n').find((line) => line.trim().length > 0)?.trim() ?? 'Task';
  return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1)}…` : first;
}

function summarise(task: Task): TaskSummary {
  return { ...task, running: tasks.isRunning(task.id) };
}

function findTask(id: string): Task | undefined {
  return state.read().tasks?.find((task) => task.id === id);
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  /** Every task, newest first — across all projects, which is the point of the Workflow page. */
  app.get('/api/tasks', async (): Promise<TaskSummary[]> =>
    [...(state.read().tasks ?? [])]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(summarise)
  );

  app.post<{ Body: { projectId?: string; description?: string; model?: string } }>(
    '/api/tasks',
    async (req, reply) => {
      const { projectId, model } = req.body ?? {};
      const description = req.body?.description?.trim() ?? '';
      if (!projectId) return badRequest(reply, 'A projectId is required.');
      if (!description) return badRequest(reply, 'Describe the task.');
      if (description.length > MAX_DESCRIPTION) {
        return badRequest(reply, `A task description is limited to ${MAX_DESCRIPTION} characters.`);
      }
      const project = state.findProject(projectId);
      if (!project) return notFound(reply, 'No such project.');
      if (model && !MODEL_OPTIONS.some((option) => option.id === model)) {
        return badRequest(reply, `Unknown model: ${model}`);
      }

      const busy = tasks.runningIn(projectId);
      if (busy) {
        return badRequest(
          reply,
          `${project.name} already has a task running.`,
          'BUSY',
          `"${findTask(busy)?.title ?? busy}" is still running. Tasks in one project share its working tree, so they run one at a time. Stop it, or wait for it to finish.`
        );
      }

      const now = new Date().toISOString();
      const task = state.update((s) => {
        const created: Task = {
          id: randomUUID(),
          projectId,
          title: titleFrom(description),
          description,
          // The CLI requires a real UUID here.
          sessionId: randomUUID(),
          model: model ?? s.settings?.defaultModel ?? '',
          status: 'idle',
          report: null,
          runs: 0,
          createdAt: now,
          updatedAt: now
        };
        s.tasks = [...(s.tasks ?? []), created];
        return created;
      });

      tasks.start(task, project, description);
      return summarise(findTask(task.id) ?? task);
    }
  );

  /**
   * A task's activity: everything so far, then live events until the run ends.
   *
   * Server-sent events like a chat's, with one difference that matters — closing this response does nothing
   * to the task. It is a window onto a run the server owns.
   */
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (req, reply) => {
    const task = findTask(req.params.id);
    if (!task) return notFound(reply, 'No such task.');

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (event: UiEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    let closed = false;
    const { history, unwatch } = tasks.watch(task.id, (event) => {
      if (closed) return;
      if (event === null) {
        closed = true;
        reply.raw.end();
        return;
      }
      send(event);
    });
    for (const event of history) send(event);

    // Not running: the history was the whole answer.
    if (!tasks.isRunning(task.id)) {
      closed = true;
      reply.raw.end();
      return reply;
    }

    reply.raw.on('close', () => {
      closed = true;
      unwatch();
    });
    return reply;
  });

  /** A follow-up, or "continue": resumes the lead's session with its context intact. */
  app.post<{ Params: { id: string }; Body: { text?: string } }>('/api/tasks/:id/message', async (req, reply) => {
    const text = req.body?.text?.trim();
    if (!text) return badRequest(reply, 'A message is required.');
    if (text.length > MAX_DESCRIPTION) {
      return badRequest(reply, `A message is limited to ${MAX_DESCRIPTION} characters.`);
    }
    const task = findTask(req.params.id);
    if (!task) return notFound(reply, 'No such task.');
    const project = state.findProject(task.projectId);
    if (!project) return notFound(reply, 'This task points at a project that no longer exists.');
    if (tasks.isRunning(task.id)) return badRequest(reply, 'This task is already running.', 'BUSY');

    const busy = tasks.runningIn(project.id);
    if (busy) {
      return badRequest(
        reply,
        `${project.name} already has a task running.`,
        'BUSY',
        `"${findTask(busy)?.title ?? busy}" is still running in the same working tree.`
      );
    }

    tasks.start(task, project, text);
    return summarise(findTask(task.id) ?? task);
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (req, reply) => {
    const stopped = await tasks.stop(req.params.id);
    return stopped ? { ok: true } : notFound(reply, 'That task is not running.');
  });

  /**
   * Deleting a task removes Flight Deck's record and its activity log.
   *
   * Nothing in the repository is touched: whatever the task changed is still in the working tree, to keep or
   * discard from the Changes panel like any other edit.
   */
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    if (!findTask(req.params.id)) return notFound(reply, 'No such task.');
    await tasks.stop(req.params.id);
    state.update((s) => {
      s.tasks = (s.tasks ?? []).filter((task) => task.id !== req.params.id);
    });
    tasks.removeLog(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/workflow', async (req, reply) => {
    const project = state.findProject(req.params.id);
    if (!project) return notFound(reply, 'No such project.');
    return configFor(project);
  });

  app.put<{ Params: { id: string }; Body: { commands?: string[] | null; knowledge?: string } }>(
    '/api/projects/:id/workflow',
    async (req, reply) => {
      const project = state.findProject(req.params.id);
      if (!project) return notFound(reply, 'No such project.');
      const { commands, knowledge } = req.body ?? {};

      if (commands !== undefined && commands !== null) {
        if (!Array.isArray(commands) || commands.some((command) => typeof command !== 'string')) {
          return badRequest(reply, 'commands must be a list of strings, or null to use the detected ones.');
        }
        const bad = commands.find((command) => !isSafeCommand(command));
        if (bad !== undefined) {
          return badRequest(
            reply,
            'That command cannot be allowed.',
            'BAD_COMMAND',
            `"${bad}" — a command must be a single line, must not start with a dash, and must not contain parentheses. It is matched as a prefix, so "npm test" already covers "npm test -- --watch".`
          );
        }
      }
      if (knowledge !== undefined) {
        if (typeof knowledge !== 'string') return badRequest(reply, 'knowledge must be text.');
        if (knowledge.length > MAX_NOTES) {
          return badRequest(reply, `Project notes are limited to ${MAX_NOTES} characters.`);
        }
        writeNotes(project.id, knowledge);
      }
      if (commands !== undefined) {
        state.update((s) => {
          const stored = s.projects.find((p) => p.id === project.id);
          if (!stored) return;
          // Null clears the override, which is different from an empty list: empty means "allow nothing".
          stored.workflowCommands = commands === null ? undefined : commands.map((command) => command.trim());
        });
      }

      const updated = state.findProject(project.id) ?? project;
      const config: ProjectWorkflowConfig = configFor(updated);
      return config;
    }
  );
}
