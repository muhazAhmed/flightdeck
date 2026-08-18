import { useEffect, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileCode2,
  Loader,
  Minus,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Undo2
} from 'lucide-react';
import type { ConfirmLevel, GitFile, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { detailOf, messageOf } from '@/lib/http';
import { gitApi } from './api';
import { BranchMenu } from './BranchMenu';
import { DiffView } from './DiffView';
import { IdentityBar } from './IdentityBar';
import { useGitPanel, type SelectedFile } from './useGitPanel';

interface ChangesPanelProps {
  project: Project | null;
  /** Bumped when a run finishes, so files the agent touched appear without a manual refresh. */
  revision: number;
  /** `all` gates every action behind a dialog; `destructive` only the ones with no undo. */
  confirmLevel: ConfirmLevel;
}

type Tab = 'unstaged' | 'staged';

/** Colour follows git's meaning, never the accent: green added, red deleted, amber modified. */
const STATUS_COLOR: Record<string, string> = {
  A: 'text-success',
  '?': 'text-success',
  M: 'text-warn',
  R: 'text-warn',
  C: 'text-warn',
  D: 'text-danger',
  U: 'text-danger'
};

export function ChangesPanel({ project, revision, confirmLevel }: ChangesPanelProps) {
  const git = useGitPanel(project?.id ?? null, revision);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [tab, setTab] = useState<Tab>('unstaged');
  const [drafting, setDrafting] = useState(false);

  const status = git.status;
  const staged = status?.staged ?? [];
  const changed = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])];
  const hasChanges = staged.length + changed.length > 0;

  // Follow the work: staging everything empties Unstaged, committing empties Staged. Move to
  // whichever side has content rather than leaving the user on a blank tab.
  useEffect(() => {
    if (tab === 'unstaged' && changed.length === 0 && staged.length > 0) setTab('staged');
    else if (tab === 'staged' && staged.length === 0 && changed.length > 0) setTab('unstaged');
  }, [tab, staged.length, changed.length]);

  // Distinct from the chat panel's message, which says the same thing three inches to the left.
  if (!project) {
    return <EmptyState title="Nothing to review" hint="Select a project to see its changes." />;
  }

  const plural = (files: string[]) => `${files.length} file${files.length === 1 ? '' : 's'}`;

  /**
   * Ask, or just do it.
   *
   * Discard and force-delete are irreversible and always ask, whatever the preference — a setting
   * that can turn off the guard on unrecoverable actions is not a preference, it is a trap. The
   * choice only governs the reversible ones: staging, unstaging, stashing, pulling, pushing.
   */
  function gate(request: ConfirmRequest, irreversible = false) {
    if (!irreversible && confirmLevel === 'destructive') {
      request.onConfirm();
      return;
    }
    setConfirm(request);
  }

  function askStage(files: string[]) {
    gate({
      title: files.length === 1 ? 'Stage this file?' : `Stage ${plural(files)}?`,
      description: 'Adds the changes to the index. Reversible — you can unstage afterwards.',
      files,
      confirmLabel: 'Stage',
      onConfirm: () => void git.stage(files)
    });
  }

  function askUnstage(files: string[]) {
    gate({
      title: files.length === 1 ? 'Unstage this file?' : `Unstage ${plural(files)}?`,
      description: 'Removes them from the index. Your edits in the working tree are untouched.',
      files,
      confirmLabel: 'Unstage',
      onConfirm: () => void git.unstage(files)
    });
  }

  function askDiscard(files: string[]) {
    // Always asks: these edits exist nowhere else.
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
    gate({
      title: 'Stash all changes?',
      description:
        'Saves everything, including untracked files, and leaves a clean working tree. Recoverable with pop.',
      files: [...staged, ...changed].map((f) => f.path),
      confirmLabel: 'Stash',
      onConfirm: () => void git.stash()
    });
  }

  function askStashPop(index: number, subject: string) {
    gate({
      title: 'Restore this stash?',
      description: 'Re-applies the stashed changes to the working tree and drops the stash entry.',
      files: [subject],
      confirmLabel: 'Pop stash',
      onConfirm: () => void git.stashPop(index)
    });
  }

  function askPull() {
    gate({
      title: `Pull ${status?.branch ?? 'this branch'}?`,
      description:
        'Fast-forward only, so nothing is merged behind your back. Refused if the working tree is dirty.',
      files: [status?.tracking ? `from ${status.tracking}` : 'no upstream configured'],
      confirmLabel: 'Pull',
      onConfirm: () => void git.remote('pull')
    });
  }

  function askPush() {
    const ahead = status?.ahead ?? 0;
    gate({
      title: `Push ${status?.branch ?? 'this branch'}?`,
      description: status?.tracking
        ? `Sends ${ahead} local commit${ahead === 1 ? '' : 's'} to ${status.tracking}. Never forced.`
        : 'This branch has no upstream yet — pushing creates it and sets the upstream.',
      files: [status?.tracking ? `${status.branch} → ${status.tracking}` : `${status?.branch} → new upstream`],
      confirmLabel: 'Push',
      onConfirm: () => void git.remote('push')
    });
  }

  async function commit() {
    if (await git.commit(message.trim())) setMessage('');
  }

  /**
   * Draft a message from the staged diff.
   *
   * Deliberately fills the box rather than committing: this is the one place in the app where a
   * model writes something that ends up permanently in history, so a human reads it first. An
   * existing draft is replaced only after confirming, since losing typed words to a misclick is
   * worse than an extra click.
   */
  async function draftMessage() {
    if (!project) return;
    setDrafting(true);
    try {
      const draft = await gitApi.draftMessage(project.id);
      setMessage(draft.message);
      if (draft.truncated) {
        toast.warning('The staged diff was too large to send whole', {
          description: 'The message describes the first part of it — check it covers everything.'
        });
      }
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setDrafting(false);
    }
  }

  function askDraft() {
    if (!message.trim()) {
      void draftMessage();
      return;
    }
    // Always asks: it would overwrite words you typed.
    setConfirm({
      title: 'Replace your message?',
      description: 'Drafting from the staged diff will overwrite what you have typed.',
      files: [message.trim().split(/\r?\n/)[0] ?? ''],
      confirmLabel: 'Replace',
      onConfirm: () => void draftMessage()
    });
  }

  const files = tab === 'staged' ? staged : changed;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface-1">
      <header className="shrink-0 border-b border-border-subtle px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-semibold tracking-tight">Changes</span>
          {hasChanges ? (
            <CountBadge value={staged.length + changed.length} />
          ) : null}

          <span className="ml-auto flex items-center gap-0.5">
            <IconButton
              label="Fetch from remote"
              disabled={git.busy}
              onClick={() => void git.remote('fetch')}
              icon={<RefreshCw size={13} className={cn(git.loading && 'animate-spin')} />}
            />
            <RemoteButton
              label="Pull"
              count={status?.behind ?? 0}
              disabled={git.busy || !status?.tracking}
              onClick={askPull}
              icon={<ArrowDownToLine size={13} />}
            />
            <RemoteButton
              label="Push"
              count={status?.ahead ?? 0}
              disabled={git.busy || !status?.branch}
              onClick={askPush}
              icon={<ArrowUpFromLine size={13} />}
            />
            <IconButton label="Git settings — not built yet" icon={<Settings size={13} />} disabled />
          </span>
        </div>

        <div className="mt-2">
          <BranchMenu
            projectId={project.id}
            status={status}
            revision={revision + git.mutations}
            onStatus={git.adoptStatus}
          />
        </div>

        <div className="mt-2.5 flex gap-1 rounded-lg border border-border-subtle bg-(--bg-base) p-1">
          <TabButton active={tab === 'unstaged'} count={changed.length} onClick={() => setTab('unstaged')}>
            Unstaged
          </TabButton>
          <TabButton active={tab === 'staged'} count={staged.length} onClick={() => setTab('staged')}>
            Staged
          </TabButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {git.error ? (
          <p className="px-4 py-3 text-[13px] text-danger">{git.error}</p>
        ) : git.loading && !status ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ) : files.length === 0 ? (
          <p className="px-4 py-4 text-[13px] leading-5 text-text-muted">
            {!hasChanges
              ? 'Working tree is clean.'
              : tab === 'staged'
                ? 'Nothing staged yet. Stage a file to commit it.'
                : 'Everything is staged.'}
          </p>
        ) : tab === 'staged' ? (
          <FileList
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
                icon={<Minus size={14} />}
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
                icon={<Minus size={13} />}
              />
            )}
          />
        ) : (
          <FileList
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
                  icon={<Undo2 size={14} />}
                />
                <IconButton
                  label="Stage all"
                  tone="accent"
                  disabled={git.busy}
                  onClick={() => askStage(changed.map((f) => f.path))}
                  icon={<Plus size={14} />}
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
                  icon={<Undo2 size={13} />}
                />
                <IconButton
                  label={`Stage ${file.path}`}
                  tone="accent"
                  revealOnGroupHover
                  alwaysVisible={isSelected}
                  disabled={git.busy}
                  onClick={() => askStage([file.path])}
                  icon={<Plus size={13} />}
                />
              </>
            )}
          />
        )}

        {git.stashes.length > 0 ? (
          <div className="border-t border-border-subtle px-2 py-2">
            <p className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-text-muted">
              Stashes
              <CountBadge value={git.stashes.length} />
            </p>
            {git.stashes.map((entry) => (
              <div key={entry.ref} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary" title={entry.subject}>
                  {entry.subject || entry.ref}
                </span>
                <span className="shrink-0 text-[11.5px] text-text-muted">{entry.when}</span>
                <IconButton
                  label="Pop this stash"
                  tone="accent"
                  revealOnGroupHover
                  disabled={git.busy}
                  onClick={() => askStashPop(entry.index, entry.subject || entry.ref)}
                  icon={<ArchiveRestore size={13} />}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {git.selected && git.diff !== null ? (
        <div className="flex min-h-0 basis-1/2 flex-col border-t border-border-default">
          <div className="flex shrink-0 items-center gap-2 bg-surface-2 px-3 py-1.5">
            <FileCode2 size={13} className="shrink-0 text-text-muted" />
            <span className="truncate font-mono text-[12px]" title={git.selected.path}>
              {git.selected.path}
            </span>
            <span className="ml-auto shrink-0 text-[11.5px] text-text-muted">
              {git.selected.staged ? 'staged' : 'working tree'}
            </span>
          </div>
          <DiffView diff={git.diff} />
        </div>
      ) : null}

      <footer className="shrink-0 border-t border-border-subtle">
        <p className="px-3 pt-2.5 pb-1.5 text-[12px] font-medium tracking-wide text-text-muted uppercase">
          Commit
        </p>
        <IdentityBar projectId={project.id} />
        <div className="p-3">
          <div className="relative mb-2.5">
          <textarea
            value={message}
            rows={3}
            placeholder={
              staged.length > 0 ? `Message for ${plural(staged.map((f) => f.path))}…` : 'Stage something to commit…'
            }
            spellCheck={false}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void commit();
              }
            }}
            className="block w-full resize-none rounded-md border border-border-default bg-surface-2 py-2 pr-10 pl-2.5 text-[13.5px] leading-5 placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
            <button
              type="button"
              onClick={askDraft}
              disabled={drafting || git.busy || staged.length === 0}
              aria-label="Draft a commit message from the staged changes"
              title={
                staged.length === 0
                  ? 'Stage something first'
                  : 'Draft a message from the staged diff (you can edit it before committing)'
              }
              className={cn(
                'absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-md',
                'transition-colors duration-(--duration-fast)',
                'text-text-muted hover:bg-surface-3 hover:text-accent-bright',
                'disabled:pointer-events-none disabled:opacity-40'
              )}
            >
              {drafting ? <Loader size={14} className="animate-spin text-accent-bright" /> : <Sparkles size={14} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              disabled={git.busy || !message.trim() || staged.length === 0}
              onClick={() => void commit()}
            >
              Commit changes
            </Button>
            <Button variant="secondary" size="md" disabled={git.busy || !hasChanges} onClick={askStash}>
              <Archive size={13} /> Stash
            </Button>
          </div>
          <p className="mt-2 text-center text-[11.5px] text-text-muted">
            <kbd className="font-mono">Ctrl</kbd> + <kbd className="font-mono">Enter</kbd> to commit
          </p>
        </div>
      </footer>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </aside>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px]',
        'transition-colors duration-(--duration-fast)',
        // Adjacent dark surfaces differ by ~1.1:1 in luminance, which is too little for a small
        // element to read on its own — the border is what actually makes the active tab visible.
        active
          ? 'border border-border bg-surface-2 font-medium text-text-primary'
          : 'border border-transparent text-text-secondary hover:bg-surface-2/60 hover:text-text-primary'
      )}
    >
      {children}
      <CountBadge value={count} />
    </button>
  );
}

interface FileListProps {
  files: GitFile[];
  selected: SelectedFile | null;
  staged: boolean;
  onSelect: (file: SelectedFile) => void;
  groupActions: ReactNode;
  rowActions: (file: GitFile, isSelected: boolean) => ReactNode;
}

function FileList({ files, selected, staged, onSelect, groupActions, rowActions }: FileListProps) {
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1 px-2 pb-1">
        <p className="flex items-center gap-1.5 text-[12px] text-text-muted">
          {staged ? 'Staged files' : 'Changed files'}
          <CountBadge value={files.length} />
        </p>
        <div className="ml-auto flex items-center gap-0.5">{groupActions}</div>
      </div>

      {files.map((file) => {
        const isSelected = selected?.path === file.path && selected.staged === staged;
        return (
          <div
            key={file.path}
            className={cn(
              'group flex items-center gap-2 rounded-md px-2 py-1',
              isSelected ? 'bg-accent-subtle' : 'hover:bg-surface-2'
            )}
          >
            <FileCode2 size={13} className="shrink-0 text-text-muted" />
            <button
              onClick={() => onSelect({ path: file.path, staged })}
              className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-text-secondary"
              title={file.path}
            >
              {file.path}
            </button>
            {rowActions(file, isSelected)}
            {/* Status letter last, like a source-control gutter: the column you scan down. */}
            <span
              className={cn(
                'w-3 shrink-0 text-center font-mono text-[12.5px]',
                STATUS_COLOR[file.status] ?? 'text-text-muted'
              )}
              title={file.status}
            >
              {file.status}
            </span>
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
      {count > 0 ? <span className="tabular -ml-1 text-[11px] text-accent-bright">{count}</span> : null}
    </div>
  );
}

/**
 * A count. Filled with the accent and labelled in white, because the earlier surface-on-surface
 * chips were a 1.1:1 difference and simply did not read as a background at all.
 *
 * Zero is the exception: a filled badge is a call to attention, and there is nothing to attend to.
 */
function CountBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'tabular inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
        value === 0
          ? 'border border-border-subtle bg-surface-3 text-text-muted'
          : 'bg-accent text-(--accent-fg)'
      )}
    >
      {value}
    </span>
  );
}
