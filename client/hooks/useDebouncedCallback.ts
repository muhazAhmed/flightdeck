import { useEffect, useMemo, useRef } from 'react';
import { createDebouncer } from '@/lib/debounce';

/**
 * React wrapper around `createDebouncer`.
 *
 * The callback is held in a ref so passing an inline arrow does not rebuild the debouncer on every
 * render — which would reset the burst deadline and defeat the whole point. Cleanup cancels a pending
 * call, so it cannot fire into an unmounted component.
 */
export function useDebouncedCallback(callback: () => void, waitMs: number, maxWaitMs: number): () => void {
  const latest = useRef(callback);
  latest.current = callback;

  const debouncer = useMemo(
    () => createDebouncer(() => latest.current(), waitMs, maxWaitMs),
    [waitMs, maxWaitMs]
  );

  useEffect(() => () => debouncer.cancel(), [debouncer]);

  return debouncer.call;
}
