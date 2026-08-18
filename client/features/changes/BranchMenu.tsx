import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Cloud, GitBranch, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BranchList, GitStatus } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { detailOf, messageOf, RequestError } from '@/lib/http';
import { branchApi } from './api';

interface BranchMenuProps {
  projectId: string;
  status: GitStatus | null;
  /** Bumped by the panel after any mutation, so the list follows a commit or a pull. */
  revision: number;
  /** Adopt the status returned by a checkout, so the file list updates with the branch. */
  onStatus: (status: GitStatus) => void;
}

/**
 * The branch control: which branch you are on, and how to move between them.
 *
 * Checkout refuses on a dirty tree rather than carrying changes across — git would happily
 * bring uncommitted edits along, which is how work lands on the wrong branch. Creating a
 * branch is the opposite case: it *does* carry the working tree, because "this shouldn't be
 * on main" is usually realised mid-edit.
 */
export function BranchMenu({ projectId, status, revision, onStatus }: BranchMenuProps) {
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    try {
      setBranches(await branchApi.list(projectId));
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) > 0;
  const current = branches?.current ?? status?.branch ?? null;

  async function checkout(branch: string) {
    setBusy(true);
    try {
      const result = await branchApi.checkout(projectId, branch);
      setBranches(result.branches);
      if (result.status) onStatus(result.status);
      toast.success(`Switched to ${branch}`, { description: result.summary });
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setBusy(false);
    }
  }

  async function create(name: string, from?: string) {
    setBusy(true);
    try {
      const result = await branchApi.create(projectId, name, from);
      setBranches(result.branches);
      if (result.status) onStatus(result.status);
      toast.success(result.summary);
      return true;
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(branch: string, force: boolean) {
    setBusy(true);
    try {
      const result = await branchApi.remove(projectId, branch, force);
      setBranches(result.branches);
      toast.success(result.summary);
    } catch (err) {
      // An unmerged branch is refused by design. Offer the forced delete as a second,
      // explicit decision rather than retrying quietly on the user's behalf.
      if (err instanceof RequestError && err.code === 'UNMERGED') {
        setConfirm({
          title: `Force-delete ${branch}?`,
          description:
            'This branch has commits that exist nowhere else. Deleting it discards them, and there is no undo.',
          files: [branch],
          confirmLabel: 'Force delete',
          tone: 'danger',
          onConfirm: () => void remove(branch, true)
        });
        return;
      }
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setBusy(false);
    }
  }

  function askCheckout(branch: string) {
    setConfirm({
      title: `Switch to ${branch}?`,
      description: 'Changes the files in your working tree to that branch.',
      files: [branch],
      confirmLabel: 'Switch',
      onConfirm: () => void checkout(branch)
    });
  }

  function askDelete(branch: string) {
    setConfirm({
      title: `Delete ${branch}?`,
      description: 'Refused if the branch holds commits that are not merged anywhere else.',
      files: [branch],
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: () => void remove(branch, false)
    });
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={busy}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[12.5px] text-text-secondary hover:bg-surface-2 disabled:opacity-40"
        >
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate font-mono">{current ?? 'detached'}</span>
          {status?.tracking ? null : <span className="shrink-0 text-text-muted">(local)</span>}
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 max-h-96 w-80 overflow-y-auto rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
          >
            {dirty ? (
              <p className="mx-1 mb-1 rounded bg-warn/10 px-2 py-1.5 text-[12.5px] text-warn">
                Uncommitted changes — switching is blocked until you commit or stash.
              </p>
            ) : null}

            <DropdownMenu.Label className="px-2 py-1 text-[12.5px] text-text-muted">Local</DropdownMenu.Label>
            {(branches?.local ?? []).map((branch) => (
              <div key={branch.name} className="group flex items-center gap-1 rounded px-1 hover:bg-surface-3">
                <DropdownMenu.Item
                  disabled={busy || branch.current || dirty}
                  onSelect={() => askCheckout(branch.name)}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 px-1 py-1.5 outline-none data-[disabled]:cursor-default data-[disabled]:opacity-60"
                >
                  <Check size={12} className={cn('mt-0.5 shrink-0', branch.current ? 'text-accent-bright' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12.5px] text-text-primary">{branch.name}</span>
                    <span className="block truncate text-[12.5px] text-text-muted">
                      {branch.subject || 'no commits'}
                      {branch.when ? ` · ${branch.when}` : ''}
                    </span>
                  </span>
                </DropdownMenu.Item>
                {branch.current ? null : (
                  <IconButton
                    label={`Delete ${branch.name}`}
                    tone="danger"
                    revealOnGroupHover
                    icon={<Trash2 size={11} />}
                    onClick={(event) => {
                      event.preventDefault();
                      askDelete(branch.name);
                    }}
                  />
                )}
              </div>
            ))}

            {(branches?.remote ?? []).length > 0 ? (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                <DropdownMenu.Label className="px-2 py-1 text-[12.5px] text-text-muted">
                  Remote — checking one out creates a local tracking branch
                </DropdownMenu.Label>
                {(branches?.remote ?? [])
                  // A remote branch already checked out locally is reachable above.
                  .filter((name) => !(branches?.local ?? []).some((l) => l.upstream === name))
                  .map((name) => (
                    <DropdownMenu.Item
                      key={name}
                      disabled={busy || dirty}
                      onSelect={() => askCheckout(name)}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3 data-[disabled]:cursor-default data-[disabled]:opacity-60"
                    >
                      <Cloud size={12} className="shrink-0 text-text-muted" />
                      <span className="truncate font-mono text-[12.5px]">{name}</span>
                    </DropdownMenu.Item>
                  ))}
              </>
            ) : null}

            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
            <DropdownMenu.Item
              onSelect={() => setCreating(true)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-surface-3"
            >
              <Plus size={12} className="text-text-muted" />
              New branch from {current ?? 'here'}…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CreateBranchDialog
        open={creating}
        base={current}
        dirty={dirty}
        busy={busy}
        onOpenChange={setCreating}
        onSubmit={async (name) => {
          if (await create(name)) setCreating(false);
        }}
      />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function CreateBranchDialog({
  open,
  base,
  dirty,
  busy,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  base: string | null;
  dirty: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-1 p-4 shadow-(--shadow-popover)">
          <Dialog.Title className="mb-1 font-medium">New branch</Dialog.Title>
          <Dialog.Description className="mb-3 text-[12.5px] leading-4 text-text-secondary">
            Branches from <span className="font-mono">{base ?? 'the current commit'}</span> and switches
            to it.
            {dirty ? ' Your uncommitted changes come along — that is usually the point.' : ''}
          </Dialog.Description>

          <input
            value={name}
            autoFocus
            spellCheck={false}
            placeholder="feat/article-schema"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim()) onSubmit(name.trim());
            }}
            className="h-8 w-full rounded border border-border-default bg-surface-2 px-2 font-mono text-[13px] placeholder:text-text-muted focus:border-accent focus:outline-none"
          />

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </Dialog.Close>
            <Button variant="primary" size="sm" disabled={!name.trim() || busy} onClick={() => onSubmit(name.trim())}>
              Create and switch
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
