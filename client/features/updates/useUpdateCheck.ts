import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { UpdateStatus } from '@shared/types';
import { detailOf, messageOf } from '@/lib/http';
import { updateApi } from './api';

/** How long an install may go without asking its remote. A tool you leave open for days should still notice. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Whether this install is behind its remote, and the toast that says so.
 *
 * TWO REQUESTS, DELIBERATELY DIFFERENT. The local read is free and happens on every launch. The fetch talks
 * to the network, so it only happens when the last one was more than six hours ago — or when the user presses
 * the button. An app that phones home on every reload would make the privacy section untrue.
 *
 * `enabled` follows `settings.checkForUpdates`; with it off, nothing is read and nothing is fetched.
 */
export function useUpdateCheck(enabled: boolean, onOpenSettings: () => void) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  /** The toast fires once per launch: seeing it again on every re-render would be its own bug. */
  const announced = useRef(false);

  const openSettings = useRef(onOpenSettings);
  openSettings.current = onOpenSettings;

  const announce = useCallback((next: UpdateStatus) => {
    if (announced.current || next.state !== 'behind') return;
    announced.current = true;
    const count = `${next.behind} new commit${next.behind === 1 ? '' : 's'}`;
    toast('Update available', {
      description: `${count} on ${next.upstream ?? 'the remote'} — ${next.incoming[0]?.subject ?? ''}`.trim(),
      duration: 12_000,
      action: { label: 'View', onClick: () => openSettings.current() }
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const local = await updateApi.get();
      setStatus(local);
      announce(local);

      // Only reach for the network when what we know is old enough to be worth refreshing.
      const age = local.lastFetchedAt ? Date.now() - Date.parse(local.lastFetchedAt) : Infinity;
      if (local.state === 'not-a-repo' || age < STALE_AFTER_MS) return;

      const fresh = await updateApi.check();
      setStatus(fresh);
      announce(fresh);
    } catch {
      // A failed update check must never interrupt the app; the settings page shows the real reason on demand.
    }
  }, [announce]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  /** Explicit check from the settings page: always contacts the remote, and reports failures out loud. */
  const check = useCallback(async () => {
    setBusy(true);
    try {
      const fresh = await updateApi.check();
      setStatus(fresh);
      if (fresh.state === 'up-to-date') toast.success('Up to date');
      else if (fresh.state === 'behind') {
        toast.success(`${fresh.behind} new commit${fresh.behind === 1 ? '' : 's'} available`);
      }
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = useCallback(async () => {
    setBusy(true);
    try {
      const result = await updateApi.apply();
      setStatus(result.status);
      // The detail carries "restart the server, run npm install if dependencies changed" — the part the user
      // has to act on, so it stays until dismissed.
      toast.success(result.message, { description: result.detail, duration: Infinity });
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err), duration: Infinity });
      // A refusal (dirty tree, diverged fork) still returns the current status; re-read so the UI agrees.
      try {
        setStatus(await updateApi.get());
      } catch {
        /* leave the previous status in place */
      }
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, check, apply, reload: load };
}
