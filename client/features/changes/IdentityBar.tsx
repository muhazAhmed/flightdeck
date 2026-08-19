import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, CircleUser, Plus, TriangleAlert, X } from 'lucide-react';
import type { IdentityState, SavedIdentity } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { detailOf, messageOf } from '@/lib/http';
import { toast } from 'sonner';
import { identityApi } from './api';

interface IdentityBarProps {
  projectId: string;
}

/**
 * Who the next commit will be attributed to, and a one-click switch.
 *
 * Sits directly above the commit box because that is the moment it matters: the failure this
 * prevents is committing a week of company work under a personal name, which is only
 * discoverable after it is already in the history.
 *
 * `scope` is shown, not hidden: `global` means this repository has no opinion and is using
 * the machine default, which is exactly the state that produces a wrong attribution.
 */
export function IdentityBar({ projectId }: IdentityBarProps) {
  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setIdentity(await identityApi.get(projectId));
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (name: string, email: string, save: boolean, label?: string) => {
      setBusy(true);
      try {
        const next = await identityApi.set(projectId, name, email, save, label);
        setIdentity(next);
        toast.success(`Committing as ${name}`, { description: email });
        return true;
      } catch (err) {
        toast.error(messageOf(err), { description: detailOf(err) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId]
  );

  async function forget(saved: SavedIdentity) {
    try {
      const result = await identityApi.forget(saved.id);
      setIdentity((current) => (current ? { ...current, saved: result.saved } : current));
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }

  const current = identity?.current;
  const unset = !current?.name || !current?.email;
  const isGlobal = current?.scope === 'global';

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={busy}
          title={
            unset
              ? 'No git identity set for this repository'
              : `Committing as ${current?.name} <${current?.email}>${isGlobal ? ' (machine default)' : ' (set for this repository)'}`
          }
          className={cn(
            'flex h-6 min-w-0 max-w-28 items-center gap-1 rounded-md border px-1.5 text-[11.5px]',
            'transition-colors duration-(--duration-fast)',
            'disabled:pointer-events-none disabled:opacity-40',
            unset
              ? 'border-warn bg-surface-2 text-warn hover:bg-surface-3'
              : 'border-border-subtle bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'
          )}
        >
          {unset ? (
            <TriangleAlert size={11} className="shrink-0" />
          ) : (
            <CircleUser size={11} className={cn('shrink-0', isGlobal ? 'text-text-muted' : 'text-accent-bright')} />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{unset ? 'No identity' : current?.name}</span>
          <ChevronDown size={10} className="shrink-0 text-text-muted" />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-72 rounded-md border border-border-default bg-surface-2 p-1 shadow-(--shadow-popover)"
          >
            <DropdownMenu.Label className="px-2 py-1 text-[12px] leading-4 text-text-muted">
              Commit as — written to this repository only
              {isGlobal ? <span className="block text-warn">Currently using the machine default</span> : null}
            </DropdownMenu.Label>

            {(identity?.saved ?? []).length === 0 ? (
              <p className="px-2 py-1.5 text-[12.5px] text-text-muted">No saved identities yet.</p>
            ) : (
              (identity?.saved ?? []).map((saved) => {
                const active = saved.name === current?.name && saved.email === current?.email;
                return (
                  <div key={saved.id} className="group flex items-center gap-1 rounded px-1 hover:bg-surface-3">
                    <DropdownMenu.Item
                      disabled={busy}
                      onSelect={() => void apply(saved.name, saved.email, false)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1 py-1.5 outline-none"
                    >
                      <Check size={12} className={cn('shrink-0', active ? 'text-accent-bright' : 'opacity-0')} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-[13px] text-text-primary">{saved.label}</span>
                        <span className="text-[12px] text-text-muted"> · {saved.email}</span>
                      </span>
                    </DropdownMenu.Item>
                    <IconButton
                      label={`Forget ${saved.label}`}
                      tone="danger"
                      revealOnGroupHover
                      icon={<X size={11} />}
                      onClick={(event) => {
                        event.preventDefault();
                        void forget(saved);
                      }}
                    />
                  </div>
                );
              })
            )}

            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
            <DropdownMenu.Item
              onSelect={() => setAdding(true)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none hover:bg-surface-3"
            >
              <Plus size={12} className="text-text-muted" />
              Add an identity…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AddIdentityDialog
        open={adding}
        onOpenChange={setAdding}
        busy={busy}
        onSubmit={async (label, name, email) => {
          const ok = await apply(name, email, true, label);
          if (ok) setAdding(false);
        }}
      />
    </>
  );
}

function AddIdentityDialog({
  open,
  onOpenChange,
  busy,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (label: string, name: string, email: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!open) {
      setLabel('');
      setName('');
      setEmail('');
    }
  }, [open]);

  const ready = name.trim().length > 0 && email.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-1 p-4 shadow-(--shadow-popover)">
          <Dialog.Title className="mb-1 font-medium">Add an identity</Dialog.Title>
          <Dialog.Description className="mb-3 text-[12.5px] text-text-secondary">
            Saved for reuse, and applied to this repository now. Your global git config is not
            touched.
          </Dialog.Description>

          <div className="flex flex-col gap-2">
            <Field label="Label" value={label} placeholder="Company" onChange={setLabel} />
            <Field label="user.name" value={name} placeholder="your name" onChange={setName} mono />
            <Field label="user.email" value={email} placeholder="you@example.com" onChange={setEmail} mono />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="primary"
              size="sm"
              disabled={!ready || busy}
              onClick={() => onSubmit(label.trim() || name.trim(), name.trim(), email.trim())}
            >
              Save and apply
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  mono = false
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] text-text-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-7 rounded border border-border-default bg-surface-2 px-2 focus:border-accent focus:outline-none',
          mono && 'font-mono text-[12.5px]'
        )}
      />
    </label>
  );
}
