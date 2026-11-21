/**
 * Running workflow tasks, and remembering what they did.
 *
 * A task run belongs to the server, not to a browser tab — the one place it differs from a chat. A chat's
 * stream is the HTTP response, so closing the tab stops the agent, which is right for a conversation. A task
 * is something you start and walk away from: leaving the Workflow page, or looking at another task, must not
 * kill it. So the run is started here, its events are kept, and any number of viewers attach and detach.
 *
 * WHY AN EVENT LOG, when DECISIONS.md says "store no message history". That rule holds for chats because the
 * CLI's transcript replays them completely. It does not replay a task: which specialist did what, what was
 * denied and what each one reported arrive as stream events that the transcript does not carry. The log is
 * the already-translated `UiEvent`s, one per line — small, append-only, and deleted with the task.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Chat, DoneEvent, Project, UiEvent } from '@shared/types';
import type { Task, TaskStatus } from '@shared/workflow';
import * as agent from './agent.js';
import { taskLogDir } from './platform.js';
import * as state from './state.js';
import * as usage from './usage.js';
import { taskArgs } from './workflow.js';

/** A viewer. Called with each event as it happens, and once with null when the run is over. */
type Listener = (event: UiEvent | null) => void;

interface Live {
  projectId: string;
  listeners: Set<Listener>;
  /** Text deltas not yet written: consecutive ones are joined into a single log line. */
  pendingText: string;
  /** The last `done` seen. A run can produce several — one per time the lead is woken by a finishing
   *  specialist — and the last is the one that describes how it ended. */
  lastDone: DoneEvent | null;
  stopped: boolean;
}

const live = new Map<string, Live>();

export function isRunning(taskId: string): boolean {
  return live.has(taskId);
}

/** The task currently running in a project, if any. One at a time: they would share a working tree. */
export function runningIn(projectId: string): string | null {
  for (const [taskId, run] of live) {
    if (run.projectId === projectId) return taskId;
  }
  return null;
}

function logPath(taskId: string): string {
  return join(taskLogDir(), `${taskId}.jsonl`);
}

function writeLine(taskId: string, event: UiEvent): void {
  try {
    mkdirSync(taskLogDir(), { recursive: true });
    appendFileSync(logPath(taskId), `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // A log that cannot be written costs the replay, not the run. The live viewers still get the event.
  }
}

function flushText(taskId: string, run: Live): void {
  if (!run.pendingText) return;
  writeLine(taskId, { type: 'text', delta: run.pendingText });
  run.pendingText = '';
}

/** Everything a task has done so far, oldest first. Empty for a task that has never run. */
export function readLog(taskId: string): UiEvent[] {
  const run = live.get(taskId);
  // Whatever is pooled goes to disk first, so the file is the whole story at the moment it is read.
  if (run) flushText(taskId, run);

  const path = logPath(taskId);
  if (!existsSync(path)) return [];
  const events: UiEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as UiEvent);
    } catch {
      // A line cut short by a crash is skipped; the rest of the log is still worth showing.
    }
  }
  return events;
}

export function removeLog(taskId: string): void {
  try {
    rmSync(logPath(taskId), { force: true });
  } catch {
    /* nothing to remove */
  }
}

/**
 * Watch a task. Returns the history so far and a function that stops watching.
 *
 * History and subscription happen in one synchronous step, so no event can fall between "read the log" and
 * "start listening". `listener` is called with null immediately when the task is not running.
 */
export function watch(taskId: string, listener: Listener): { history: UiEvent[]; unwatch: () => void } {
  const history = readLog(taskId);
  const run = live.get(taskId);
  if (!run) {
    return { history, unwatch: () => {} };
  }
  run.listeners.add(listener);
  return { history, unwatch: () => run.listeners.delete(listener) };
}

/**
 * Send a prompt to a task's lead session and return once it has started.
 *
 * The first run claims the session id; every later one resumes it, which is what makes a follow-up or a
 * "continue" pick up with the lead's context intact rather than rediscovering the project.
 */
export function start(task: Task, project: Project, prompt: string): void {
  const run: Live = {
    projectId: project.id,
    listeners: new Set(),
    pendingText: '',
    lastDone: null,
    stopped: false
  };
  live.set(task.id, run);

  const resume = task.runs > 0;
  state.update((s) => {
    const stored = s.tasks?.find((t) => t.id === task.id);
    if (!stored) return;
    stored.runs += 1;
    // Not "running": that is derived from the live process. If the server dies mid-run this is what remains,
    // and it reads as interrupted rather than as a run that will never end.
    stored.status = 'idle';
    stored.updatedAt = new Date().toISOString();
  });

  const emit = (event: UiEvent) => {
    if (event.type === 'text') {
      run.pendingText += event.delta;
    } else {
      flushText(task.id, run);
      writeLine(task.id, event);
    }
    for (const listener of run.listeners) listener(event);
  };

  // The prompt is logged like any other event, so a replay shows what was asked as well as what was done.
  emit({ type: 'prompt', text: prompt });

  // agent.ts keys a run by chat id and reads four fields off the chat; a task supplies the same four.
  const session: Chat = {
    id: task.id,
    projectId: project.id,
    parentChatId: null,
    title: task.title,
    sessionId: task.sessionId,
    // Edits are accepted; anything that executes goes through the allow list in workflow.ts.
    permissionMode: 'acceptEdits',
    model: task.model || undefined,
    createdAt: task.createdAt,
    lastMessageAt: null
  };

  const settings = state.read().settings;
  const workflow = { ...(settings?.workflow ?? { leadPrompt: '', roles: [], allowedTools: [] }) };

  void agent
    .send(
      project,
      session,
      prompt,
      resume,
      (event) => {
        if (event.type === 'done') {
          run.lastDone = event;
          usage.append({
            at: new Date().toISOString(),
            projectId: project.id,
            chatId: task.id,
            model: event.usage?.model ?? (task.model || null),
            numTurns: event.numTurns ?? 0,
            durationMs: event.durationMs ?? 0,
            costUsd: event.costUsd ?? 0,
            inputTokens: event.usage?.inputTokens ?? 0,
            outputTokens: event.usage?.outputTokens ?? 0,
            cacheReadTokens: event.usage?.cacheReadTokens ?? 0,
            cacheCreationTokens: event.usage?.cacheCreationTokens ?? 0,
            isError: event.isError,
            denials: event.denials.length
          });
        }
        if (event.type === 'rate_limit') {
          state.update((s) => {
            s.lastRateLimit = {
              resetsAt: event.resetsAt,
              rateLimitType: event.rateLimitType,
              seenAt: new Date().toISOString()
            };
          });
        }
        emit(event);
      },
      settings?.maxTurns ?? 0,
      taskArgs(workflow, project)
    )
    .then(() => {
      flushText(task.id, run);

      const status: TaskStatus = run.stopped
        ? 'stopped'
        : run.lastDone && !run.lastDone.isError
          ? 'done'
          : 'failed';
      state.update((s) => {
        const stored = s.tasks?.find((t) => t.id === task.id);
        if (!stored) return;
        stored.status = status;
        // A stopped or failed run keeps the previous report: an empty one would hide the last thing it said.
        if (run.lastDone?.result) stored.report = run.lastDone.result;
        stored.updatedAt = new Date().toISOString();
      });

      live.delete(task.id);
      for (const listener of run.listeners) listener(null);
    });
}

/** Stop a task's process. The run's own completion handler records it as stopped. */
export async function stop(taskId: string): Promise<boolean> {
  const run = live.get(taskId);
  if (!run) return false;
  run.stopped = true;
  return agent.abort(taskId);
}
