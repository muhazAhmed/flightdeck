import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { TaskSummary } from '@shared/workflow';
import { detailOf, messageOf } from '@/lib/http';
import { tasksApi } from './api';

/** How often the list is re-read while something is running. A status change is not urgent to the second. */
const POLL_MS = 3000;

/**
 * The task list, and the actions on it.
 *
 * Polled only while a task is running: a task's run belongs to the server, so the list is the one thing that
 * has to notice a run ending when no viewer is attached to it — a task in another project, say. With nothing
 * running there is nothing to notice, and nothing is fetched.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // Reported once, not on every failed poll: a server that is down would otherwise stack a toast every 3s.
  const reported = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setTasks(await tasksApi.list());
      reported.current = false;
    } catch (error) {
      if (!reported.current) toast.error(messageOf(error), { description: detailOf(error) });
      reported.current = true;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyRunning = tasks.some((task) => task.running);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  const upsert = useCallback((task: TaskSummary) => {
    setTasks((current) =>
      current.some((existing) => existing.id === task.id)
        ? current.map((existing) => (existing.id === task.id ? task : existing))
        : [task, ...current]
    );
  }, []);

  const create = useCallback(
    async (projectId: string, description: string, model: string) => {
      try {
        const task = await tasksApi.create(projectId, description, model);
        upsert(task);
        return task;
      } catch (error) {
        toast.error(messageOf(error), { description: detailOf(error), duration: Infinity });
        return null;
      }
    },
    [upsert]
  );

  const message = useCallback(
    async (id: string, text: string) => {
      try {
        upsert(await tasksApi.message(id, text));
        return true;
      } catch (error) {
        toast.error(messageOf(error), { description: detailOf(error), duration: Infinity });
        return false;
      }
    },
    [upsert]
  );

  const stop = useCallback(
    async (id: string) => {
      try {
        await tasksApi.stop(id);
      } catch (error) {
        toast.error(messageOf(error), { description: detailOf(error) });
      }
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(async (id: string) => {
    try {
      await tasksApi.remove(id);
      setTasks((current) => current.filter((task) => task.id !== id));
      return true;
    } catch (error) {
      toast.error(messageOf(error), { description: detailOf(error) });
      return false;
    }
  }, []);

  return { tasks, loading, refresh, create, message, stop, remove };
}
