import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[var(--accent-fg)] hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3',
  ghost: 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10'
};

const SIZES: Record<Size, string> = {
  sm: 'h-6 px-2 text-[12.5px] gap-1.5 rounded',
  md: 'h-8 px-3 gap-2 rounded'
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-colors duration-[var(--duration-fast)]',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  );
}
