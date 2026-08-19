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
  Sparkles,
  Trash2,
  Undo2,
  X
} from 'lucide-react';
import type { ConfirmLevel, GitFile, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { EmptyState } from '@/shared/ui/EmptyState';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { useHotkey } from '@/hooks/useHotkey';
import { detailOf, messageOf } from '@/lib/http';
import { gitApi } from './api';
import { BranchMenu } from './BranchMenu';
import { DiffView } from './DiffView';
import { HistoryPanel } from './HistoryPanel';
import { IdentityBar } from './IdentityBar';
import { useGitPanel, type SelectedFile } from './useGitPanel';

interface ChangesPanelProps {
  project: Project | null;
  /** Bumped when a run finishes, so files the agent touched appear without a manual refresh. */
  revision: number;
  /** `all` gates every action behind a dialog; `destructive` only the ones with no undo. */
  confirmLevel: ConfirmLevel;
}

type Tab = 'unstaged' | 'staged' | 'history';

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

  // Escape closes the open diff. The shell's global Escape also fires, but it only returns to the workspace view,
  // which is where we already are — so the two do not fight.
  useHotkey('Escape', () => git.select(null), { ctrl: false, inFields: true });

  const status = git.status;
  const staged = status?.staged ?? [];
  const changed = [...(status?.unstaged ?? []), ...(status?.untracked ?? [])];
  const hasChanges = staged.length + changed.length > 0;

  // Follow the work: staging everything empties Unstaged, committing empties Staged. Move to
  // whichever side has content rather than leaving the user on a blank tab.
  useEffect(() => {
    // Only ever moves between the two working-tree tabs. Yanking someone out of History because they staged a
    // file would be the panel overruling a deliberate choice.
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

  /**
   * Dropping a stash is the one action here with no way back.
   *
   * `setConfirm` rather than `gate`, so it asks even when the confirmation level is "only destructive" — this IS
   * the destructive one. Discard and force-delete are handled the same way.
   */
  function askStashDrop(index: number, subject: string) {
    setConfirm({
      title: 'Delete this stash?',
      description:
        'Deletes the stashed changes without applying them. This cannot be undone from Flight Deck — the entry is gone and its contents with it.',
      files: [subject],
      confirmLabel: 'Delete stash',
      tone: 'danger',
      onConfirm: () => void git.stashDrop(index, subject)
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
        {/* Branch and identity are context, not actions: small chips in the title row's corner,
            leaving the full-width row below for the things you actually press. */}
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-semibold tracking-tight">Changes</span>
          {hasChanges ? <CountBadge value={staged.length + changed.length} /> : null}

          <span className="ml-auto flex min-w-0 items-center gap-1">
            <BranchMenu
              projectId={project.id}
              status={status}
              revision={revision + git.mutations}
              onStatus={git.adoptStatus}
            />
            <IdentityBar projectId={project.id} />
          </span>
        </div>

        {/*
          Labelled buttons, not bare icons. Three arrows in a row is a guessing game — up and down
          could mean push/pull, expand/collapse, or sort, and "which arrow was push?" is not a
          question a tool should ask twice a day. The counts sit inside the label so the button also
          answers "is there anything to send?" without a tooltip.
        */}
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          <RemoteButton
            label="Fetch"
            hint="Check the remote for new commits without changing your files"
            icon={<RefreshCw size={13} className={cn(git.loading && 'animate-spin')} />}
            disabled={git.busy}
            onClick={() => void git.remote('fetch')}
          />
          <RemoteButton
            label="Pull"
            count={status?.behind ?? 0}
            hint={
              status?.tracking
                ? 'Bring down commits from the upstream branch (fast-forward only)'
                : 'This branch has no upstream to pull from'
            }
            icon={<ArrowDownToLine size={13} />}
            disabled={git.busy || !status?.tracking}
            onClick={askPull}
          />
          <RemoteButton
            label="Push"
            count={status?.ahead ?? 0}
            hint={
              status?.tracking
                ? 'Send your local commits to the upstream branch. Never forced'
                : 'Publish this branch and set its upstream'
            }
            icon={<ArrowUpFromLine size={13} />}
            disabled={git.busy || !status?.branch}
            onClick={askPush}
          />
        </div>

        <div className="mt-2.5 flex gap-1 rounded-lg border border-border-subtle bg-(--bg-base) p-1">
          <TabButton active={tab === 'unstaged'} count={changed.length} tone="changed" onClick={() => setTab('unstaged')}>
            Unstaged
          </TabButton>
          <TabButton active={tab === 'staged'} count={staged.length} tone="staged" onClick={() => setTab('staged')}>
            Staged
          </TabButton>
          <TabButton active={tab === 'history'} onClick={() => setTab('history')}>History</TabButton>
        </div>
      </header>

      {tab === 'history' ? (
        <HistoryPanel projectId={project.id} revision={revision} />
      ) : (
        <>
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
              <CountBadge value={git.stashes.length} tone="stash" />
            </p>
            {git.stashes.map((entry) => (
              <div key={entry.ref} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary" title={entry.subject}>
                  {entry.subject || entry.ref}
                </span>
                <span className="shrink-0 text-[11.5px] text-text-muted">{entry.when}</span>
                <IconButton
                  label="Restore this stash — applies it and removes the entry"
                  tone="accent"
                  revealOnGroupHover
                  disabled={git.busy}
                  onClick={() => askStashPop(entry.index, entry.subject || entry.ref)}
                  icon={<ArchiveRestore size={13} />}
                />
                <IconButton
                  label="Delete this stash without applying it"
                  tone="danger"
                  revealOnGroupHover
                  disabled={git.busy}
                  onClick={() => askStashDrop(entry.index, entry.subject || entry.ref)}
                  icon={<Trash2 size={13} />}
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
            {/* Until this existed a diff could not be dismissed at all: clicking the same row again was a no-op
                and nothing else cleared the selection. */}
            <IconButton label="Close the diff (Esc)" icon={<X size={13} />} onClick={() => git.select(null)} />
          </div>
          <DiffView diff={git.diff} />
        </div>
      ) : null}

      <footer className="shrink-0 border-t border-border-subtle">
        <p className="px-3 pt-2.5 pb-1.5 text-[12px] font-medium tracking-wide text-text-muted uppercase">
          Commit
        </p>
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
        </>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </aside>
  );
}

function TabButton({
  active,
  count,
  tone,
  onClick,
  children
}: {
  active: boolean;
  /** Omitted for tabs that are not a set of files — History counts nothing useful. */
  count?: number;
  tone?: BadgeTone;
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
      {count === undefined || tone === undefined ? null : <CountBadge value={count} tone={tone} />}
    </button>
  );
}

interface FileListProps {
  files: GitFile[];
  selected: SelectedFile | null;
  staged: boolean;
  onSelect: (file: SelectedFile | null) => void;
  groupActions: ReactNode;
  rowActions: (file: GitFile, isSelected: boolean) => ReactNode;
}

function FileList({ files, selected, staged, onSelect, groupActions, rowActions }: FileListProps) {
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1 px-2 pb-1">
        <p className="flex items-center gap-1.5 text-[12px] text-text-muted">
          {staged ? 'Staged files' : 'Changed files'}
          <CountBadge value={files.length} tone={staged ? 'staged' : 'changed'} />
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
              // Clicking the row that is already open closes it, which is what a second click on a toggle means
              // everywhere else in this app.
              onClick={() => onSelect(isSelected ? null : { path: file.path, staged })}
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
 * One remote action: icon, word, and how many commits it involves.
 *
 * The count is not decoration — pushing is safe to offer precisely because you can see what you are
 * about to send before you press it. The `title` carries the longer explanation so a first-time user
 * can find out what fetch does without leaving the app.
 */
function RemoteButton({
  label,
  hint,
  count = 0,
  disabled,
  onClick,
  icon
}: {
  label: string;
  hint: string;
  count?: number;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={count > 0 ? `${hint} (${count} commit${count === 1 ? '' : 's'})` : hint}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12.5px]',
        'transition-colors duration-(--duration-fast)',
        'disabled:pointer-events-none disabled:opacity-40',
        count > 0
          ? 'border-accent bg-accent-subtle font-medium text-text-primary hover:bg-surface-3'
          : 'border-border-subtle bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
      )}
    >
      <span className={cn('shrink-0', count > 0 && 'text-accent-bright')}>{icon}</span>
      {label}
      {count > 0 ? <CountBadge value={count} tone="accent" /> : null}
    </button>
  );
}

/** What a count is about, so the colour carries meaning instead of decorating. */
type BadgeTone = 'accent' | 'staged' | 'changed' | 'stash';

const BADGE_TONE: Record<BadgeTone, string> = {
  accent: 'bg-accent',
  // Staged is work that is ready; changed is work still in progress; a stash is set aside. Each gets
  // a fill that already means that elsewhere in the app, rather than a second shade of the accent.
  staged: 'bg-fill-success',
  changed: 'bg-fill-warn',
  stash: 'bg-fill-info'
};

/**
 * A count.
 *
 * Filled and white-labelled because surface-on-surface chips were a 1.1:1 difference and read as no
 * background at all. All four fills carry white above 4.9:1 in both themes.
 *
 * ONE OR TWO DIGITS ARE A CIRCLE, not a padded pill: `size-5` fixes both axes so a single digit is
 * round rather than an oval, which is what horizontal padding produces. Three digits or more widen
 * into a pill, because a circle that fits "100" would be a large blob everywhere else.
 *
 * Zero is the exception: a filled badge is a call to attention and zero has nothing to attend to.
 */
function CountBadge({ value, tone = 'accent' }: { value: number; tone?: BadgeTone }) {
  const wide = value > 99;
  return (
    <span
      className={cn(
        'tabular inline-flex shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-semibold',
        wide ? 'h-5 px-1.5' : 'size-5',
        value === 0
          ? 'border border-border-subtle bg-surface-3 text-text-muted'
          : cn(BADGE_TONE[tone], 'text-white')
      )}
    >
      {value}
    </span>
  );
}
