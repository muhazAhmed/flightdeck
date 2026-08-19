import { cn } from '@/lib/cn';

/**
 * A switch.
 *
 * The knob is anchored with `left-0.5` and moved by exactly its own travel (`translate-x-5`).
 * Without the anchor an absolutely-positioned child takes its static position from the button's
 * centred text alignment, so the translate pushed it 20px right *of centre* and it hung off the
 * track — which is precisely how this looked before.
 *
 * Geometry, so the numbers are checkable rather than magic: track 44x24 (`w-11 h-6`), knob 20
 * (`size-5`), inset 2 (`0.5`). Travel = 44 - 20 - 2 - 2 = 20 = `translate-x-5`.
 */
export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-(--duration-fast)',
        checked ? 'border-accent bg-accent' : 'border-border bg-surface-3'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm',
          'transition-transform duration-(--duration-fast)',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}
