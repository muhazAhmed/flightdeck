import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ToolStatus } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { toolsApi } from './api';

/**
 * What this machine has, asked when a feature needs it.
 *
 * `checks` counts how many times the user has asked again. The count is the UI's cue for the sentence that
 * matters most on Windows — a tool installed a minute ago is invisible to a server process that started
 * before it, and without that sentence "check again" looks like it does nothing.
 */
export function useTools(enabled: boolean) {
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState(0);
  /**
   * Why the list is missing, when it is.
   *
   * Without this, a failed request left `tools` null forever and the gate rendered a skeleton that never
   * resolved — a dead page whose only clue was a toast that had already faded. Found by the first review this
   * feature ever ran.
   */
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      const result = await toolsApi.get(refresh);
      setTools(result.tools);
      setError(null);
    } catch (err) {
      setError(detailOf(err) ? `${messageOf(err)} — ${detailOf(err)}` : messageOf(err));
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load(false);
  }, [enabled, load]);

  const recheck = useCallback(async () => {
    setChecks((n) => n + 1);
    await load(true);
  }, [load]);

  /**
   * Sign in by handing a token over.
   *
   * Returns whether it worked so the form can keep the field for a second attempt: clearing a rejected token
   * means retyping it to fix a typo. On success the status comes straight back, so the gate opens without a
   * second request.
   */
  const signIn = useCallback(async (token: string): Promise<boolean> => {
    setLoading(true);
    try {
      const result = await toolsApi.ghLogin(token);
      setTools(result.tools);
      toast.success('Signed in to GitHub');
      return true;
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { tools, loading, checks, error, recheck, signIn };
}
