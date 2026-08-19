/**
 * Trailing debounce with a guaranteed maximum wait.
 *
 * A plain trailing debounce is the wrong tool for a stream of agent edits: a run that writes a file
 * every 300ms for a minute would never fire once, and whatever it feeds would sit still through the
 * whole thing. `maxWaitMs` turns the first call of a burst into a deadline — bursts still collapse
 * into one call, but you are never more than that far behind.
 *
 * Pure and framework-free so it can be tested directly; `useDebouncedCallback` is the React wrapper.
 * `now` is injectable for the same reason.
 */
export interface Debouncer {
  call: () => void;
  cancel: () => void;
}

export function createDebouncer(
  run: () => void,
  waitMs: number,
  maxWaitMs: number,
  now: () => number = () => Date.now()
): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** When the current burst began, so the deadline is measured from the first call, not the last. */
  let burstStartedAt: number | null = null;

  const fire = () => {
    timer = null;
    burstStartedAt = null;
    run();
  };

  return {
    call() {
      const at = now();
      if (burstStartedAt === null) burstStartedAt = at;

      const waited = at - burstStartedAt;
      if (timer) clearTimeout(timer);

      // Deadline already reached: fire now and let the next call start a fresh burst.
      if (waited >= maxWaitMs) {
        fire();
        return;
      }

      // Never schedule past the deadline, however long the calls keep coming.
      timer = setTimeout(fire, Math.min(waitMs, maxWaitMs - waited));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      burstStartedAt = null;
    }
  };
}
