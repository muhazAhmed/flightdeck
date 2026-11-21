import { EmptyState } from '@/shared/ui/EmptyState';

/**
 * The Workflow view.
 *
 * A placeholder on purpose: the sidebar entry and the view exist so the navigation can be settled first, and
 * what a workflow *is* gets built on top of it. It says so rather than pretending to be a feature.
 */
export function WorkflowPage() {
  return (
    <div className="flex h-full flex-col bg-(--bg-base)">
      <EmptyState title="Workflow" hint="Nothing here yet." />
    </div>
  );
}
