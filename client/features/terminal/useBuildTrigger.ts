import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { detailOf, messageOf } from '@/lib/http';
import { gitApi } from '@/features/changes/api';

/**
 * The empty-commit-and-push trigger behind the terminal's build button.
 *
 * Runs server-side rather than by typing the two commands into the shell. Three reasons, in order of
 * how badly each would bite:
 *
 *   1. `git commit ... && git push` is not valid in Windows PowerShell 5.1, which is the default shell
 *      on this platform — the chained form would half-run and look like a Flight Deck bug.
 *   2. Typed input goes to whatever the shell is currently running. Press it during a build and the
 *      text lands in that process instead.
 *   3. The server already has one audited push path (no force, no --all, remote read from config), and
 *      a second one typed as a string is exactly what should not exist.
 *
 * The cost is that the output appears as a toast rather than in the terminal, which is why the toast
 * carries git's own summary verbatim.
 */
export function useBuildTrigger(projectId: string | null, onCommitted: () => void) {
  const [running, setRunning] = useState(false);

  const trigger = useCallback(async () => {
    if (!projectId || running) return;
    setRunning(true);
    try {
      const result = await gitApi.triggerBuild(projectId);
      toast.success('Build triggered', { description: result.summary });
      // The branch has a new commit and is no longer ahead; the Changes panel should say so.
      onCommitted();
    } catch (err) {
      // A staged index, no remote, or a rejected push each arrive here with git's own words.
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setRunning(false);
    }
  }, [projectId, running, onCommitted]);

  return { trigger, running };
}
