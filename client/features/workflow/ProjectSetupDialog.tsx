import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@shared/types';
import type { ProjectWorkflowConfig } from '@shared/workflow';
import { Button } from '@/shared/ui/Button';
import { detailOf, messageOf } from '@/lib/http';
import { projectSetupApi } from './projectSetupApi';

interface ProjectSetupDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIELD =
  'w-full rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary ' +
  'placeholder:text-text-muted focus:border-accent-bright focus:outline-none';

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * What the agents may run in one project, and what the Lead Engineer should know about it.
 *
 * Commands show the detected list when none has been set. Saving that list untouched stores null rather
 * than a copy, so a later change to package.json scripts is still picked up.
 */
export function ProjectSetupDialog({ project, open, onOpenChange }: ProjectSetupDialogProps) {
  const [config, setConfig] = useState<ProjectWorkflowConfig | null>(null);
  const [commandsText, setCommandsText] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [saving, setSaving] = useState(false);

  const projectId = project?.id;
  // Held in a ref so a parent passing an inline callback does not reload the form on every render.
  const close = useRef(onOpenChange);
  close.current = onOpenChange;

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setConfig(null);
    projectSetupApi
      .get(projectId)
      .then((loaded) => {
        if (cancelled) return;
        setConfig(loaded);
        setCommandsText((loaded.commands ?? loaded.detected).join('\n'));
        setKnowledge(loaded.knowledge);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(messageOf(err), { description: detailOf(err) });
        close.current(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const usingDetected = config !== null && sameList(lines(commandsText), config.detected);

  async function save() {
    if (!project || !config) return;
    const parsed = lines(commandsText);
    setSaving(true);
    try {
      await projectSetupApi.save(project.id, {
        commands: sameList(parsed, config.detected) ? null : parsed,
        knowledge
      });
      toast.success('Project setup saved');
      onOpenChange(false);
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(680px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-default bg-surface-1 shadow-(--shadow-popover)">
          <header className="border-b border-border-subtle px-4 py-3">
            <Dialog.Title className="font-medium">Workflow setup</Dialog.Title>
            <Dialog.Description className="text-[12.5px] leading-4 text-text-secondary">
              What agents may run in <span className="font-mono">{project?.name ?? 'this project'}</span>, and
              what the Lead Engineer knows about it.
            </Dialog.Description>
          </header>

          {config === null ? (
            <p className="flex min-h-40 items-center justify-center gap-2 py-8 text-[12.5px] text-text-muted">
              <Loader size={13} className="animate-spin" /> Loading…
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <label htmlFor="setup-commands" className="text-[13.5px] font-medium">
                    Commands the agents may run
                  </label>
                  {usingDetected ? (
                    <span className="text-[12.5px] text-text-muted">Detected from package.json</span>
                  ) : null}
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={usingDetected}
                    onClick={() => setCommandsText(config.detected.join('\n'))}
                  >
                    Use detected
                  </Button>
                </div>
                <textarea
                  id="setup-commands"
                  rows={7}
                  value={commandsText}
                  spellCheck={false}
                  placeholder="npm test"
                  onChange={(e) => setCommandsText(e.target.value)}
                  className={`${FIELD} font-mono text-[12.5px] leading-5`}
                />
                <p className="mt-1 text-[12.5px] leading-4 text-text-muted">
                  One command per line, matched as a prefix: <span className="font-mono">npm test</span> also
                  allows <span className="font-mono">npm test -- --watch</span>. Anything not listed that
                  executes is denied. git commit, push and branch switching are always denied.
                </p>
              </div>

              <div>
                <label htmlFor="setup-notes" className="mb-1 block text-[13.5px] font-medium">
                  Project notes
                </label>
                <textarea
                  id="setup-notes"
                  rows={14}
                  value={knowledge}
                  onChange={(e) => setKnowledge(e.target.value)}
                  className={`${FIELD} min-h-64 font-mono text-[12.5px] leading-5`}
                />
                <p className="mt-1 text-[12.5px] leading-4 text-text-muted">
                  The Lead Engineer reads this at the start of every task and updates it when it learns
                  something. Kept in Flight Deck&apos;s own data folder, not in the repository.
                </p>
              </div>
            </div>
          )}

          <footer className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={config === null || saving} onClick={() => void save()}>
              {saving ? <Loader size={12} className="animate-spin" /> : null}
              Save
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
