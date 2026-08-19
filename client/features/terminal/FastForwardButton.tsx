import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { toast } from 'sonner';
import type { BranchList, Project } from '@shared/types';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { detailOf, messageOf } from '@/lib/http';
import { branchApi, mergeApi } from '@/features/changes/api';
import { projectsApi } from '@/features/projects/api';

/**
 * Spellings of the integration branch, in the order they are tried.
 *
 * The workflow this serves is "a pull request landed on dev, bring the trunk up to it", so the first guess is the
 * remote dev branch. Only ever a guess for the *first* click — the chosen ref is remembered on the project, and the
 * button always shows which ref it will use.
 */
const LIKELY = ['origin/dev', 'origin/develop', 'origin/development'];

interface FastForwardButtonProps {
  project: Project;
  /** Called after a successful fast-forward so the Changes panel picks up the new position. */
  onMerged: () => void;
}

/**
 * Fast-forward the checked-out branch onto another ref, from the terminal header.
 *
 * Placed here, beside the build trigger, because it is the same kind of step: a short git command run by hand
 * several times a day, immediately before pushing. It runs as a server-side git command rather than as typed input,
 * for the same three reasons the build trigger does — see useBuildTrigger.ts.
 *
 * `--ff-only`, and it never pushes.
 */
export function FastForwardButton({ project, onMerged }: FastForwardButtonProps) {
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [running, setRunning] = useState(false);
  /** Remembered ref, held locally too so the label updates without waiting for the project list to reload. */
  const [chosen, setChosen] = useState<string | undefined>(project.fastForwardRef);

  const load = useCallback(async () => {
    try {
      setBranches(await branchApi.list(project.id));
    } catch {
      // Without a branch list the button offers nothing; the Changes panel reports the failure.
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setChosen(project.fastForwardRef), [project.fastForwardRef]);

  const current = branches?.current ?? null;

  /** Everything that could be fast-forwarded onto: remote refs first, since they are the answer nearly always. */
  const candidates = useMemo(() => {
    const remotes = (branches?.remote ?? []).filter((name) => name !== `origin/${current ?? ''}`);
    const locals = (branches?.local ?? []).filter((branch) => !branch.current).map((branch) => branch.name);
    return [...remotes, ...locals];
  }, [branches, current]);

  /** The remembered ref if it still exists, else the first likely one, else nothing. */
  const target =
    (chosen && candidates.includes(chosen) ? chosen : undefined) ??
    LIKELY.find((name) => candidates.includes(name));

  async function merge(ref: string) {
    setRunning(true);
    try {
      const result = await mergeApi.fastForward(project.id, ref);
      toast.success(result.summary, { description: 'Nothing was pushed — that stays yours to do.' });
      // Remembered only once it has actually worked here.
      if (ref !== chosen) {
        setChosen(ref);
        void projectsApi.update(project.id, { fastForwardRef: ref }).catch(() => {});
      }
      onMerged();
      await load();
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err), duration: Infinity });
    } finally {
      setRunning(false);
    }
  }

  function ask(ref: string) {
    const onto = current ?? 'this branch';
    const offTrunk = branches?.defaultBranch != null && current != null && current !== branches.defaultBranch;

    setConfirm({
      title: `Fast-forward ${onto} to ${ref}?`,
      description: offTrunk
        ? `You are on ${onto}, not ${branches?.defaultBranch}. This moves ${onto} forward to ${ref}, and pushes nothing.`
        : `Moves ${onto} forward to ${ref} if it can, and refuses if it cannot. No merge commit, and nothing is pushed.`,
      files: [`git merge --ff-only ${ref}`],
      confirmLabel: 'Fast-forward',
      tone: offTrunk ? 'danger' : 'default',
      onConfirm: () => void merge(ref)
    });
  }

  /*
   * Shown only on the trunk.
   *
   * The step this serves is "a pull request landed on dev, bring the trunk up to it", so on any other branch the
   * button was offering a command that did not apply — and it read as broken, because it named `origin/dev` no
   * matter where you were. Absent is clearer than disabled here: there is nothing to explain, the step simply is
   * not the one you are on.
   *
   * `defaultBranch` comes from the repository's own `origin/HEAD`, so this is not a guess about what "main" means.
   *
   * It also requires a ref to merge: a remembered one, or one of the `LIKELY` dev spellings. A repository with no
   * dev branch at all gets no button, rather than one that names a branch which does not exist.
   */
  const onTrunk = branches?.defaultBranch != null && current === branches.defaultBranch;
  if (!onTrunk || !target) return null;

  return (
    <>
      <button
        onClick={() => ask(target)}
        disabled={running}
        title={`git merge --ff-only ${target} — fast-forward ${current}, nothing pushed`}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2 py-1',
          'text-[11.5px] text-text-secondary hover:bg-surface-3 hover:text-text-primary',
          'transition-colors duration-(--duration-fast)',
          'disabled:pointer-events-none disabled:opacity-40'
        )}
      >
        <GitMerge size={12} className="text-accent-bright" />
        <span className="font-mono">{running ? 'merging…' : target}</span>
      </button>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
