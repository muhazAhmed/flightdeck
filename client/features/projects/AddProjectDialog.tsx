import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUp, Check, Folder, FolderGit2, Loader } from 'lucide-react';
import type { BrowseResult } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/lib/cn';
import { messageOf } from '@/lib/http';
import { projectsApi } from './api';

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string) => Promise<unknown>;
}

/**
 * Folder picker. A browser cannot hand us a real directory path — `<input type="file">`
 * gives a sandboxed handle, not `E:\code\thing` — so the server lists directories and
 * this walks them. It also means the picker can mark which folders are git repos, which
 * a native dialog could not.
 *
 * There is no default starting directory: the server opens at the last browsed folder,
 * or the user's home. Guessing a projects root would be wrong for everyone but the author.
 */
export function AddProjectDialog({ open, onOpenChange, onAdd }: AddProjectDialogProps) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const browse = useCallback(async (dir?: string) => {
    setLoading(true);
    setError(null);
    try {
      setListing(await projectsApi.browse(dir));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void browse();
  }, [open, browse]);

  const current = listing?.dir ?? '';

  async function add(path: string) {
    setAdding(true);
    const result = await onAdd(path);
    setAdding(false);
    if (result) onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 flex max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg border border-border-default bg-surface-1 shadow-[var(--shadow-popover)]'
          )}
        >
          <header className="border-b border-border-subtle px-4 py-3">
            <Dialog.Title className="font-medium">Add a project</Dialog.Title>
            <Dialog.Description className="text-[12.5px] text-text-muted">
              Pick any folder that is a git repository. Nested repositories count as separate projects.
            </Dialog.Description>
          </header>

          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!listing?.parent || loading}
              onClick={() => listing?.parent && void browse(listing.parent)}
              title="Up one level"
            >
              <ArrowUp size={13} />
            </Button>
            <input
              value={current}
              spellCheck={false}
              onChange={(event) => setListing(listing ? { ...listing, dir: event.target.value } : null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void browse(current);
              }}
              className="h-7 min-w-0 flex-1 rounded border border-border-default bg-surface-2 px-2 font-mono text-[12.5px] focus:border-accent focus:outline-none"
            />
            {loading ? <Loader size={13} className="animate-spin text-text-muted" /> : null}
          </div>

          <div className="min-h-48 flex-1 overflow-y-auto p-1.5">
            {error ? (
              <p className="px-2 py-3 text-[12.5px] text-danger">{error}</p>
            ) : listing?.entries.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-text-muted">No sub-folders here.</p>
            ) : (
              listing?.entries.map((entry) => (
                <div
                  key={entry.path}
                  className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-surface-2"
                >
                  <button
                    onClick={() => void browse(entry.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {entry.isRepo ? (
                      <FolderGit2 size={14} className="shrink-0 text-accent-bright" />
                    ) : (
                      <Folder size={14} className="shrink-0 text-text-muted" />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </button>
                  {entry.isRepo ? (
                    <Button variant="primary" size="sm" disabled={adding} onClick={() => void add(entry.path)}>
                      <Check size={12} /> Add
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
            <span className="text-[12.5px] text-text-muted">
              Repositories are marked in cyan. Add the folder you are browsing, or one from the list.
            </span>
            <div className="flex shrink-0 gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button variant="primary" size="sm" disabled={!current || adding} onClick={() => void add(current)}>
                Add this folder
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
