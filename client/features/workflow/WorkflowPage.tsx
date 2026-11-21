import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Project, Settings } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useWorkspace } from '@/store/workspace';
import { NewTaskForm } from './NewTaskForm';
import { ProjectSetupDialog } from './ProjectSetupDialog';
import { TaskDetail } from './TaskDetail';
import { taskStatusLabel, taskStatusTone } from './taskStatus';
import { useTasks } from './useTasks';

interface WorkflowPageProps {
  projects: Project[];
  settings: Settings;
}

/**
 * The Workflow view: every task across every imported project, and the one you are looking at.
 *
 * A list and a detail pane, like the pull-request page. The list is the cross-project part — it is the only
 * place that shows work in several repositories at once — and the detail pane is either a task or the form
 * that starts one.
 */
export function WorkflowPage({ projects, settings }: WorkflowPageProps) {
  const { tasks, loading, refresh, create, message, stop, remove } = useTasks();
  const selectedProjectId = useWorkspace((s) => s.selectedProjectId);
  const selectProject = useWorkspace((s) => s.selectProject);
  const setView = useWorkspace((s) => s.setView);

  // Null means the new-task form. Starts there when nothing exists yet, which is what the page is for.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setupFor, setSetupFor] = useState<string | null>(null);

  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const projectOf = (id: string) => projects.find((project) => project.id === id) ?? null;
  const busyProjectIds = tasks.filter((task) => task.running).map((task) => task.projectId);

  return (
    <div className="flex h-full min-w-0 bg-(--bg-base)">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border-subtle bg-surface-1">
        <header className="flex shrink-0 items-center justify-between px-3 py-2.5">
          <h1 className="text-[14px] font-semibold tracking-tight">Workflow</h1>
          <Button size="sm" variant={selected ? 'secondary' : 'primary'} onClick={() => setSelectedId(null)}>
            <Plus size={12} />
            New task
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex flex-col gap-2 px-1">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="px-2 py-3 text-[13px] leading-5 text-text-muted">
              No tasks yet. Describe one and the Lead Engineer takes it from there.
            </p>
          ) : (
            tasks.map((task) => {
              const isSelected = task.id === selectedId;
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedId(task.id)}
                  className={cn(
                    'mb-0.5 flex w-full flex-col gap-0.5 rounded-md border-l-2 px-2 py-1.5 text-left',
                    'transition-colors duration-(--duration-fast)',
                    isSelected
                      ? 'border-accent-bright bg-accent-subtle text-text-primary'
                      : 'border-transparent hover:bg-surface-2'
                  )}
                >
                  <span className="truncate text-[13.5px] font-medium">{task.title}</span>
                  <span className="flex items-center gap-2 text-[11.5px] text-text-muted">
                    <span className={cn('flex shrink-0 items-center gap-1', taskStatusTone(task))}>
                      <span className={cn('size-1.5 rounded-full bg-current', task.running && 'animate-pulse')} />
                      {taskStatusLabel(task)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{projectOf(task.projectId)?.name ?? 'Project removed'}</span>
                    <span className="tabular shrink-0">{relativeTime(task.updatedAt)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {selected ? (
          <TaskDetail
            // Keyed so switching tasks starts from an empty draft and scroll position rather than inheriting them.
            key={selected.id}
            task={selected}
            project={projectOf(selected.projectId)}
            roles={settings.workflow.roles}
            onMessage={(text) => message(selected.id, text)}
            onStop={() => void stop(selected.id)}
            onDelete={() => {
              void remove(selected.id).then((removed) => {
                if (removed) setSelectedId(null);
              });
            }}
            onReview={() => {
              selectProject(selected.projectId);
              setView('workspace');
            }}
            onOpenSetup={() => setSetupFor(selected.projectId)}
            onEnded={() => void refresh()}
          />
        ) : (
          <NewTaskForm
            projects={projects}
            initialProjectId={selectedProjectId}
            busyProjectIds={busyProjectIds}
            defaultModel={settings.defaultModel}
            onStart={async (projectId, description, model) => {
              const task = await create(projectId, description, model);
              if (task) setSelectedId(task.id);
              return task !== null;
            }}
            onOpenSetup={setSetupFor}
          />
        )}
      </main>

      <ProjectSetupDialog
        project={setupFor ? projectOf(setupFor) : null}
        open={setupFor !== null}
        onOpenChange={(open) => {
          if (!open) setSetupFor(null);
        }}
      />
    </div>
  );
}
