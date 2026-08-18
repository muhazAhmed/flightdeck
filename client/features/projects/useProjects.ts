import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { useWorkspace } from '@/store/workspace';
import { projectsApi } from './api';

interface UseProjects {
  projects: Project[];
  loading: boolean;
  unreachable: boolean;
  reload: () => Promise<void>;
  add: (path: string) => Promise<Project | null>;
  remove: (id: string) => Promise<void>;
}

export function useProjects(): UseProjects {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const selectProject = useWorkspace((s) => s.selectProject);
  const selectedProjectId = useWorkspace((s) => s.selectedProjectId);

  const reload = useCallback(async () => {
    try {
      setProjects(await projectsApi.list());
      setUnreachable(false);
    } catch (error) {
      setUnreachable(true);
      toast.error(messageOf(error), { description: detailOf(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (path: string) => {
      try {
        const project = await projectsApi.add(path);
        setProjects((current) => [...current, project]);
        selectProject(project.id);
        return project;
      } catch (error) {
        toast.error(messageOf(error), { description: detailOf(error) });
        return null;
      }
    },
    [selectProject]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await projectsApi.remove(id);
        setProjects((current) => current.filter((p) => p.id !== id));
        if (selectedProjectId === id) selectProject(null);
      } catch (error) {
        toast.error(messageOf(error), { description: detailOf(error) });
      }
    },
    [selectProject, selectedProjectId]
  );

  return { projects, loading, unreachable, reload, add, remove };
}
