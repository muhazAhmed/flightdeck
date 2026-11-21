import type { TaskSummary } from '@shared/workflow';

/**
 * A task's status in words.
 *
 * `idle` after at least one run means the process went away without reporting an end — the server was
 * restarted mid-run. That is called what it is, because "idle" would read as "never started".
 */
export function taskStatusLabel(task: TaskSummary): string {
  if (task.running) return 'Running';
  switch (task.status) {
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'idle':
      return task.runs > 0 ? 'Interrupted' : 'Not started';
  }
}

/** Green and red are semantic only (CLAUDE.md rule 2): succeeded and failed. Everything else is neutral or accent. */
export function taskStatusTone(task: TaskSummary): string {
  if (task.running) return 'text-accent-bright';
  if (task.status === 'done') return 'text-success';
  if (task.status === 'failed') return 'text-danger';
  if (task.status === 'stopped' || task.runs > 0) return 'text-warn';
  return 'text-text-muted';
}
