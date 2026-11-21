import { useState } from 'react';
import { Play, SlidersHorizontal } from 'lucide-react';
import { MODEL_OPTIONS, type Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { Picker } from '@/features/settings/controls/Picker';

interface NewTaskFormProps {
  projects: Project[];
  /** Preselected project — the one open in the workspace, which is nearly always the one meant. */
  initialProjectId: string | null;
  /** Projects that already have a task running; a second would share the working tree. */
  busyProjectIds: string[];
  defaultModel: string;
  onStart: (projectId: string, description: string, model: string) => Promise<boolean>;
  onOpenSetup: (projectId: string) => void;
}

/**
 * Hand a task to the Lead Engineer.
 *
 * Three decisions and nothing else: which repository, what to do, which model leads. Whether to delegate, and
 * to whom, is the lead's call per task — offering it here would mean guessing the shape of work nobody has
 * looked at yet.
 */
export function NewTaskForm({
  projects,
  initialProjectId,
  busyProjectIds,
  defaultModel,
  onStart,
  onOpenSetup
}: NewTaskFormProps) {
  const [projectId, setProjectId] = useState<string>(
    initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : (projects[0]?.id ?? '')
  );
  const [description, setDescription] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [starting, setStarting] = useState(false);

  const busy = busyProjectIds.includes(projectId);
  const canStart = projectId !== '' && description.trim().length > 0 && !busy && !starting;

  async function start() {
    if (!canStart) return;
    setStarting(true);
    const started = await onStart(projectId, description.trim(), model);
    setStarting(false);
    // Kept on failure, so a refused task does not cost the brief that was just written.
    if (started) setDescription('');
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-text-muted">
        Add a project first — a task runs inside one of your imported repositories.
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 py-8">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">New task</h2>
        <p className="mt-1 text-[13px] leading-5 text-text-muted">
          The Lead Engineer reads the repository, plans, implements, runs the project&apos;s checks and reports
          back. It edits the working tree only — you review the diff and commit.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium tracking-wide text-text-muted uppercase">Project</span>
        <div className="flex flex-wrap items-center gap-2">
          <Picker
            label="Project"
            value={projectId}
            options={projects.map((project) => ({ value: project.id, label: project.name, hint: project.path }))}
            onChange={setProjectId}
          />
          <Button variant="ghost" onClick={() => onOpenSetup(projectId)} title="Allowed commands and project notes">
            <SlidersHorizontal size={13} />
            Project setup
          </Button>
        </div>
        {busy ? (
          <p className="text-[12.5px] text-warn">
            This project already has a task running. Tasks in one project share its working tree, so they run one at
            a time.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium tracking-wide text-text-muted uppercase">Task</span>
        <textarea
          value={description}
          autoFocus
          spellCheck={false}
          placeholder="Describe the change, the bug, or what to investigate. Say how you will know it is done."
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl+Enter starts; plain Enter is a new line, because a brief is usually more than one.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void start();
            }
          }}
          className="min-h-44 resize-y rounded-lg border border-border-default bg-surface-2 px-3 py-2.5 text-[14px] leading-[1.6] placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-text-muted">Lead model</span>
          <Picker
            label="Lead model"
            value={model}
            options={MODEL_OPTIONS.map((option) => ({ value: option.id, label: option.label, hint: option.hint }))}
            onChange={setModel}
          />
        </div>
        <Button variant="primary" className="ml-auto" disabled={!canStart} onClick={() => void start()}>
          <Play size={13} />
          {starting ? 'Starting…' : 'Start task'}
        </Button>
      </div>
      <p className="text-right font-mono text-[11.5px] text-text-muted">Ctrl+Enter to start</p>
    </div>
  );
}
