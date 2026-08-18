import * as Tooltip from '@radix-ui/react-tooltip';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'children'> {
  /** Doubles as the tooltip text and the accessible name — an icon-only control must
   *  never ship without one (DESIGN.md, accessibility). */
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'accent' | 'danger';
  /** Reveal on hover of the containing group. Keeps dense file rows quiet until pointed
   *  at, while remaining reachable by keyboard (focus overrides the opacity). */
  revealOnGroupHover?: boolean;
  /** Force it visible regardless of hover — used for the selected row, so the controls are
   *  discoverable without having to find them by pointing. */
  alwaysVisible?: boolean;
}

const TONES: Record<NonNullable<IconButtonProps['tone']>, string> = {
  default: 'text-text-muted hover:text-text-primary',
  accent: 'text-text-muted hover:text-accent-bright',
  danger: 'text-text-muted hover:text-danger'
};

export function IconButton({
  label,
  icon,
  tone = 'default',
  revealOnGroupHover = false,
  alwaysVisible = false,
  className,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded',
            'transition-colors duration-[var(--duration-fast)]',
            'disabled:pointer-events-none disabled:opacity-40',
            revealOnGroupHover && !alwaysVisible && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            TONES[tone],
            className
          )}
          {...props}
        >
          {icon}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={4}
          className="z-50 rounded border border-border-default bg-surface-3 px-2 py-1 text-[12.5px] text-text-primary shadow-[var(--shadow-popover)]"
        >
          {label}
          <Tooltip.Arrow className="fill-[var(--surface-3)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
