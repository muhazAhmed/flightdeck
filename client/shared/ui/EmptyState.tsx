import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-text-secondary">{title}</p>
      {hint ? <p className="max-w-sm text-[12.5px] leading-4 text-text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}
