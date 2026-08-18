import { useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Undo2
} from 'lucide-react';
import type { GitFile, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { DiffView } from './DiffView';
import { IdentityBar } from './IdentityBar';
import { useGitPanel, type SelectedFile } from './useGitPanel';

interface ChangesPanelProps {
  project: Project | null;
  /** Bumped when a run finishes, so files the agent touched appear without a manual
   *  refresh. */
  revision: number;
}

/** Colour follows git's meaning, never the accent: green added, red deleted, amber
 *  modified. */
const STATUS_COLOR: Record<string, string> = {
  A: 'text-success',
  '?': 'text-success',
  M: 'text-warn',
  R: 'text-warn',
  C: 'text-warn',
  D: 'text-danger',
  U: 'text-danger'
};

export function ChangesPanel({ project, revision }: ChangesPanelProps) {
  const git = useGitPanel(project?.id ?? null, revision);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  if (!project) return <EmptyState title="No project selected" />;

  const { status } = git;
  const changed = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])];
  const staged = status?.staged ?? [];
  const hasChanges = staged.length + changed.length > 0;

  const plural = (files: string[]) => `${files.length} file${files.length === 1 ? '' : 's'}`;

  function askStage(files: string[]) {
    setConfirm({
      title: files.length === 1 ? 'Stage this file?' : `Stage ${plural(files)}?`,
      description: 'Adds the changes to the index. Reversible — you can unstage afterwards.',
      files,
      confirmLabel: 'Stage',
      onConfirm: () => void git.stage(files)
    });
  }

  function askUnstage(files: string[]) {
    setConfirm({
      title: files.length === 1 ? 'Unstage this file?' : `Unstage ${plural(files)}?`,
      description: 'Removes them from the index. Your edits in the working tree are untouched.',
      files,
      confirmLabel: 'Unstage',
      onConfirm: () => void git.unstage(files)
    });
  }

  function askDiscard(files: string[]) {
    setConfirm({
      title: files.length === 1 ? 'Discard this file?' : `Discard ${plural(files)}?`,
      description: 'This cannot be undone — these edits are not in git yet.',
      files,
      confirmLabel: 'Discard',
      tone: 'danger',
      onConfirm: () => void git.discard(files)
    });
  }

  function askStash() {
    const files = [...staged, ...changed].map((f) => f.path);
    setConfirm({
      title: 'Stash all changes?',
      description: 'Saves everything, including untracked files, and leaves a clean working tree. Recoverable with pop.',
      files,
      confirmLabel: 'Stash',
      onConfirm: () => void git.stash()
    });
  }

  function askStashPop(index: number, subject: string) {
    setConfirm({
      title: 'Restore this stash?',
      description: 'Re-applies the stashed changes to the working tree and drops the stash entry.',
      files: [subject],
      confirmLabel: 'Pop stash',
      onConfirm: () => void git.stashPop(index)
    });
  }

  function askPull() {
    const branch = status?.branch ?? 'this branch';
    setConfirm({
      title: `Pull ${branch}?`,
      description:
        'Fast-forward only, so nothing is merged behind your back. Refused if the working tree is dirty.',
      files: status?.tracking ? [`from ${status.tracking}`] : ['no upstream configured'],
      confirmLabel: 'Pull',
      onConfirm: () => void git.remote('pull')
    });
  }

  function askPush() {
    const branch = status?.branch ?? 'this branch';
    const ahead = status?.ahead ?? 0;
    setConfirm({
      title: `Push ${branch}?`,
      description: status?.tracking
        ? `Sends ${ahead} local commit${ahead === 1 ? '' : 's'} to ${status.tracking}. Never forced.`
        : 'This branch has no upstream yet — pushing will create it and set the upstream.',
      files: [status?.tracking ? `${branch} → ${status.tracking}` : `${branch} → new upstream branch`],
      confirmLabel: 'Push',
      onConfirm: () => void git.remote('push')
    });
  }

  async function commit() {
    if (await git.commit(message.trim())) setMessage('');
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border-subtle bg-surface-1">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-[12.5px] font-medium tracking-wide text-text-muted uppercase">Changes</span>
        {status?.branch ? (
          <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-text-secondary">
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate font-mono">{status.branch}</span>
            {status.tracking ? null : <span className="text-[12.5px] text-text-muted">(no upstream)</span>}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="Fetch from remote"
            disabled={git.busy}
            onClick={() => void git.remote('fetch')}
            icon={<RefreshCw size={12} className={cn(git.loading && 'animate-spin')} />}
          />
          <RemoteButton
            label="Pull"
            count={status?.behind ?? 0}
            disabled={git.busy || !status?.tracking}
            onClick={askPull}
            icon={<ArrowDownToLine size={12} />}
          />
          <RemoteButton
            label="Push"
            count={status?.ahead ?? 0}
            disabled={git.busy || !status?.branch}
            onClick={askPush}
            icon={<ArrowUpFromLine size={12} />}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {git.error ? (
          <p className="px-3 py-2 text-[12.5px] text-danger">{git.error}</p>
        ) : git.loading && !status ? (
          <div className="flex flex-col gap-1.5 p-3">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        ) : !hasChanges ? (
          <p className="px-3 py-3 text-[12.5px] text-text-muted">Working tree is clean.</p>
        ) : (
          <>
            {staged.length > 0 ? (
              <FileGroup
                label="Staged"
                files={staged}
                selected={git.selected}
                staged
                onSelect={git.select}
                groupActions={
                  <IconButton
                    label="Unstage all"
                    tone="accent"
                    disabled={git.busy}
                    onClick={() => askUnstage(staged.map((f) => f.path))}
                    icon={<Minus size={13} />}
                  />
                }
                rowActions={(file, isSelected) => (
                  <IconButton
                    label={`Unstage ${file.path}`}
                    tone="accent"
                    revealOnGroupHover
                    alwaysVisible={isSelected}
                    disabled={git.busy}
                    onClick={() => askUnstage([file.path])}
                    icon={<Minus size={12} />}
                  />
                )}
              />
            ) : null}

            {changed.length > 0 ? (
              <FileGroup
                label="Changed"
                files={changed}
                selected={git.selected}
                staged={false}
                onSelect={git.select}
                groupActions={
                  <>
                    <IconButton
                      label="Discard all changes"
                      tone="danger"
                      disabled={git.busy}
                      onClick={() => askDiscard(changed.map((f) => f.path))}
                      icon={<Undo2 size={13} />}
                    />
                    <IconButton
                      label="Stage all"
                      tone="accent"
                      disabled={git.busy}
                      onClick={() => askStage(changed.map((f) => f.path))}
                      icon={<Plus size={13} />}
                    />
                  </>
                }
                rowActions={(file, isSelected) => (
                  <>
                    <IconButton
                      label={`Discard ${file.path}`}
                      tone="danger"
                      revealOnGroupHover
                      alwaysVisible={isSelected}
                      disabled={git.busy}
                      onClick={() => askDiscard([file.path])}
                      icon={<Undo2 size={12} />}
                    />
                    <IconButton
                      label={`Stage ${file.path}`}
                      tone="accent"
                      revealOnGroupHover
                      alwaysVisible={isSelected}
                      disabled={git.busy}
                      onClick={() => askStage([file.path])}
                      icon={<Plus size={12} />}
                    />
                  </>
                )}
              />
            ) : null}
          </>
        )}

        {git.stashes.length > 0 ? (
          <div className="border-t border-border-subtle px-1.5 py-1.5">
            <p className="px-2 py-1 text-[12.5px] text-text-muted">
              Stashes <span className="tabular">({git.stashes.length})</span>
            </p>
            {git.stashes.map((entry) => (
              <div key={entry.ref} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary" title={entry.subject}>
                  {entry.subject || entry.ref}
                </span>
                <span className="shrink-0 text-[12.5px] text-text-muted">{entry.when}</span>
                <IconButton
                  label="Pop this stash"
                  tone="accent"
                  revealOnGroupHover
                  disabled={git.busy}
                  onClick={() => askStashPop(entry.index, entry.subject || entry.ref)}
                  icon={<ArchiveRestore size={12} />}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {git.selected && git.diff !== null ? (
        <div className="flex min-h-0 basis-1/2 flex-col border-t border-border-default">
          <div className="flex shrink-0 items-center gap-2 bg-surface-2 px-3 py-1.5">
            <span className="truncate font-mono text-[12.5px]" title={git.selected.path}>
              {git.selected.path}
            </span>
            <span className="ml-auto shrink-0 text-[12.5px] text-text-muted">
              {git.selected.staged ? 'staged' : 'working tree'}
            </span>
          </div>
          <DiffView diff={git.diff} />
        </div>
      ) : null}

      <footer className="shrink-0 border-t border-border-subtle">
        <IdentityBar projectId={project.id} />
        <div className="p-2">
          <textarea
          value={message}
          rows={2}
          placeholder={
            staged.length > 0
              ? `Commit message for ${plural(staged.map((f) => f.path))}…`
              : 'Stage something to commit…'
          }
          spellCheck={false}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void commit();
            }
          }}
            className="mb-2 block w-full resize-none rounded border border-border-default bg-surface-2 px-2 py-1.5 text-[13px] placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={git.busy || !message.trim() || staged.length === 0}
              onClick={() => void commit()}
            >
              Commit
            </Button>
            <Button variant="secondary" size="sm" disabled={git.busy || !hasChanges} onClick={askStash}>
              <Archive size={12} /> Stash
            </Button>
          </div>
        </div>
      </footer>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </aside>
  );
}

interface FileGroupProps {
  label: string;
  files: GitFile[];
  selected: SelectedFile | null;
  staged: boolean;
  onSelect: (file: SelectedFile) => void;
  /** Icon buttons for the whole group, shown in the header row. */
  groupActions: ReactNode;
  /** Icon buttons for one file, revealed on row hover. */
  rowActions: (file: GitFile, isSelected: boolean) => ReactNode;
}

function FileGroup({ label, files, selected, staged, onSelect, groupActions, rowActions }: FileGroupProps) {
  return (
    <div className="px-1.5 py-1.5">
      <div className="flex items-center gap-1 px-2 py-1">
        <p className="text-[12.5px] text-text-muted">
          {label} <span className="tabular">({files.length})</span>
        </p>
        <div className="ml-auto flex items-center gap-0.5">{groupActions}</div>
      </div>

      {files.map((file) => {
        const isSelected = selected?.path === file.path && selected.staged === staged;
        return (
          <div
            key={`${label}-${file.path}`}
            className={cn(
              'group flex items-center gap-1.5 rounded px-2 py-0.5',
              isSelected ? 'bg-accent-subtle' : 'hover:bg-surface-2'
            )}
          >
            <span
              className={cn(
                'w-3 shrink-0 text-center font-mono text-[12.5px]',
                STATUS_COLOR[file.status] ?? 'text-text-muted'
              )}
              title={file.status}
            >
              {file.status}
            </span>
            <button
              onClick={() => onSelect({ path: file.path, staged })}
              className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-text-secondary"
              title={file.path}
            >
              {file.path}
            </button>
            {rowActions(file, isSelected)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Fetch / pull / push, each showing how many commits are involved. The count is the point:
 * pushing is safe to offer precisely because you can see what you are about to send.
 */
function RemoteButton({
  label,
  count,
  disabled,
  onClick,
  icon
}: {
  label: string;
  count: number;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center">
      <IconButton
        label={count > 0 ? `${label} (${count} commit${count === 1 ? '' : 's'})` : label}
        tone="accent"
        disabled={disabled}
        onClick={onClick}
        icon={icon}
      />
      {count > 0 ? <span className="tabular -ml-0.5 text-[12.5px] text-accent-bright">{count}</span> : null}
    </div>
  );
}
