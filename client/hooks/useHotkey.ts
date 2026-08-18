import { useEffect } from 'react';

interface HotkeyOptions {
  ctrl?: boolean;
  shift?: boolean;
  /** Fire even while focus is inside an input or textarea. Off by default so typing
   *  "b" in the prompt box does not collapse the sidebar. */
  inFields?: boolean;
}

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Window-level keyboard shortcut. `key` is compared case-insensitively. */
export function useHotkey(key: string, handler: () => void, options: HotkeyOptions = {}): void {
  const { ctrl = true, shift = false, inFields = false } = options;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      if (ctrl !== (event.ctrlKey || event.metaKey)) return;
      if (shift !== event.shiftKey) return;
      if (!inFields) {
        const target = event.target as HTMLElement | null;
        if (target && (FIELD_TAGS.has(target.tagName) || target.isContentEditable)) return;
      }
      event.preventDefault();
      handler();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, handler, ctrl, shift, inFields]);
}
