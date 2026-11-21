import { useEffect, useState } from 'react';

export type ServerReadiness = 'waiting' | 'slow' | 'ready';

const POLL_MS = 500;
/** After this long it is no longer "still starting" — the server is probably not running at all. */
const SLOW_AFTER_MS = 10_000;

/**
 * Has the API answered yet?
 *
 * REPORTED FROM USE: `npm run dev` starts two processes, and Vite binds seconds before Fastify does. A tab
 * opened in that gap fired every first-load request into a proxy with nothing behind it — 502s, an empty
 * project list, "No git identity" — and none of them retried, so the app stayed broken until a manual refresh.
 *
 * Gating the whole shell on one probe fixes every first-load request at once, where a retry per hook would
 * have to be remembered by each new one. `/api/settings` because it is answered from memory and spawns nothing.
 */
export function useServerReady(): ServerReadiness {
  const [readiness, setReadiness] = useState<ServerReadiness>('waiting');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const probe = async () => {
      let ok = false;
      try {
        // The timeout matters: a half-open socket would otherwise hang the poll instead of retrying.
        const response = await fetch('/api/settings', { signal: AbortSignal.timeout(2000) });
        // Vite's proxy answers 502 while the server is still down, so reachable is not the same as ready.
        ok = response.ok;
      } catch {
        /* not up yet */
      }
      if (cancelled) return;
      if (ok) {
        setReadiness('ready');
        return;
      }
      if (Date.now() - started > SLOW_AFTER_MS) setReadiness('slow');
      timer = setTimeout(() => void probe(), POLL_MS);
    };

    void probe();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return readiness;
}
