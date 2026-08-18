import { cn } from '@/lib/cn';

/** Placeholder row. Used instead of a spinner so the shell renders instantly and each
 *  panel fills in independently. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-2', className)} />;
}
