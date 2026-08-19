import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  title,
  icon,
  muted = false,
  children
}: {
  title: string;
  icon: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border-subtle bg-surface-1 p-4',
        muted && 'border-dashed bg-transparent'
      )}
    >
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-text-secondary uppercase">
        <span className="text-text-muted">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
