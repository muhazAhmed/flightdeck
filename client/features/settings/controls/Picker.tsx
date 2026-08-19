import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * A dropdown for lists too long for a segmented control.
 *
 * Four models side by side push the row past the panel edge, and the hints that make the choice
 * meaningful have nowhere to sit. Same Radix menu the chat header uses, so a model list looks the same
 * wherever you meet it.
 */
export function Picker<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false
}: {
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        disabled={disabled || options.length === 0}
        className={cn(
          'flex min-w-44 items-center gap-2 rounded-lg border border-border-default bg-surface-2 px-3 py-1.5',
          'text-left text-[13px] hover:bg-surface-3 disabled:opacity-50'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? value ?? '—'}</span>
        <ChevronDown size={12} className="shrink-0 text-text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => onChange(option.value)}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
            >
              <Check
                size={13}
                className={cn('mt-0.5 shrink-0', option.value === value ? 'text-accent-bright' : 'opacity-0')}
              />
              <span className="min-w-0">
                <span className="block text-[13px]">{option.label}</span>
                {option.hint ? (
                  <span className="block text-[11.5px] leading-4 text-text-muted">{option.hint}</span>
                ) : null}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
