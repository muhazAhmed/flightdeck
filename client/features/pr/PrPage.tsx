import { useState, type ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { GitPullRequest, X } from 'lucide-react';
import type { Project } from '@shared/types';
import { IconButton } from '@/shared/ui/IconButton';
import { BranchReview } from '@/features/review/BranchReview';
import { ToolGate } from '@/features/tools/ToolGate';
import { PrSidebar, type PrSelection } from './PrSidebar';
import { PullDetail } from './PullDetail';
import { usePulls } from './usePulls';

interface PrPageProps {
  /** Whose branch is reviewed, and whose shell the terminal below opens in. */
  project: Project | null;
  /** Every imported project: the pull-request list is cross-repository, which is the point of the page. */
  projects: Project[];
  /**
   * The terminal, when it is open.
   *
   * Passed in rather than mounted here so it is the same component and the same session the workspace uses — a
   * second terminal implementation would be a second set of bugs, and a second shell would be worse.
   */
  terminal: ReactNode;
  onClose: () => void;
}

/**
 * Review, and pull requests.
 *
 * A LIST AND A DETAIL PANE, not one long card. The first version stacked everything — branch review, then every
 * project's pull requests, then whatever diff you were reading — in a single scroll, and four pull requests were
 * enough to make it unusable. Reported as "everything is spammed in one card", which was fair.
 *
 * The split is not decoration: a review of a 600-line pull request needs the width, and the list has to stay
 * scannable while you read one. Every mail client and every code-review tool lands here for the same reason.
 *
 * The left column is ungated. Reviewing your own branch needs git and the agent, nothing else — only the pull
 * request half needs `gh`, and putting the gate in front of both would withhold the useful part for no reason.
 */
export function PrPage({ project, projects, terminal, onClose }: PrPageProps) {
  const [selection, setSelection] = useState<PrSelection>({ kind: 'branch' });
  const { groups, loading, refresh } = usePulls(project?.id ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--bg-base)">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-5 py-3">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <GitPullRequest size={16} className="text-accent-bright" />
          Review
        </h1>
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-text-muted">
          Your branch before you raise it, and every open pull request across {projects.length} projects.
        </p>
        <IconButton label="Close" icon={<X size={16} />} onClick={onClose} />
      </header>

      <div className="min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          <Panel id="pr-list" defaultSize="26" minSize="18" maxSize="42">
            <PrSidebar
              project={project}
              groups={groups}
              loading={loading}
              selection={selection}
              onSelect={setSelection}
              onRefresh={() => void refresh()}
            />
          </Panel>

          <Separator className="w-px shrink-0 bg-border-subtle transition-colors duration-(--duration-fast) hover:w-[3px] hover:bg-accent-bright data-[state=drag]:bg-accent-bright" />

          <Panel id="pr-detail" minSize="40">
            {selection.kind === 'branch' ? (
              <BranchReview project={project} />
            ) : (
              /* Only this half needs the GitHub CLI, so the gate lives here rather than around the page. */
              <ToolGate requires={['gh']}>
                {() => <PullDetail projectId={selection.projectId} number={selection.number} />}
              </ToolGate>
            )}
          </Panel>
        </Group>
      </div>

      {/* Fixed share of the height rather than a drag handle: this is somewhere a command runs while you read
          the page above it, not a workspace to be resized. */}
      {terminal && project ? <div className="h-[34%] min-h-40 shrink-0">{terminal}</div> : null}
    </div>
  );
}
