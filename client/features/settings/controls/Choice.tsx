import { cn } from '@/lib/cn';

/** A segmented control rather than a `<select>`: two or three options are faster to hit than a
 *  dropdown, and the current value is visible without opening anything. */
export function Choice<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border-subtle bg-(--bg-base) p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1 text-[13px] transition-colors duration-(--duration-fast)',
            value === option.value
              ? 'border border-border bg-surface-2 font-medium text-text-primary'
              : 'border border-transparent text-text-secondary hover:text-text-primary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
