import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A bounded numeric control.
 *
 * Two buttons rather than a text field because every value in between is valid and the range is
 * small: there is nothing to type, no way to enter something the server will reject, and no
 * half-typed state to debounce. The buttons disable at the ends instead of silently clamping, so the
 * limit is visible rather than surprising.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix,
  label,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  label: string;
  onChange: (value: number) => void;
}) {
  // Floating-point steps (0.5) accumulate error; one decimal is the most this ever needs.
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)) * 10) / 10;

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-(--bg-base) p-1">
      <button
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        className={cn(
          'flex size-6 items-center justify-center rounded-md text-text-secondary',
          'hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent'
        )}
      >
        <Minus size={13} />
      </button>
      <span className="tabular min-w-14 text-center text-[13px]">
        {value}
        {suffix ? <span className="text-text-muted">{suffix}</span> : null}
      </span>
      <button
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        className={cn(
          'flex size-6 items-center justify-center rounded-md text-text-secondary',
          'hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent'
        )}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
