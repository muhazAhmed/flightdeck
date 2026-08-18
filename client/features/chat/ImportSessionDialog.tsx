import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, Loader, MessageSquare, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { DiscoveredSession, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { chatsApi } from './api';

interface ImportSessionDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Adopt a Claude Code session that Flight Deck did not start.
 *
 * Every session for this project's folder is on disk regardless of where it was run — the IDE
 * extension, a bare terminal, or an earlier install. Importing one records its id, after which
 * its transcript renders like any other chat and it can be continued.
 *
 * Sessions touched in the last few minutes are marked as probably open elsewhere. Two clients
 * writing to one session id will fight, so that warning is the point of the label rather than
 * decoration.
 */
export function ImportSessionDialog({ project, open, onOpenChange, onImported }: ImportSessionDialogProps) {
  const [sessions, setSessions] = useState<DiscoveredSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!project) return;
    setSessions(null);
    try {
      setSessions(await chatsApi.discoverable(project.id));
    } catch (err) {
      setSessions([]);
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, [project]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function adopt(session: DiscoveredSession) {
    if (!project) return;
    setBusy(session.sessionId);
    try {
      const chat = await chatsApi.importSession(project.id, session.sessionId);
      toast.success(`Imported "${chat.title}"`);
      onImported();
      onOpenChange(false);
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-default bg-surface-1 shadow-(--shadow-popover)">
          <header className="border-b border-border-subtle px-4 py-3">
            <Dialog.Title className="font-medium">Import an existing session</Dialog.Title>
            <Dialog.Description className="text-[12.5px] leading-4 text-text-secondary">
              Claude Code sessions found for{' '}
              <span className="font-mono">{project?.name ?? 'this project'}</span> — including ones
              started in your editor or a terminal. Importing reads the existing transcript; nothing
              is copied or moved.
            </Dialog.Description>
          </header>

          <div className="min-h-40 flex-1 overflow-y-auto p-1.5">
            {sessions === null ? (
              <p className="flex items-center justify-center gap-2 py-8 text-[12.5px] text-text-muted">
                <Loader size={13} className="animate-spin" /> Reading transcripts…
              </p>
            ) : sessions.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12.5px] leading-4 text-text-muted">
                No un-imported sessions for this folder.
                <br />
                Sessions appear here once Claude Code has run in it.
              </p>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="flex items-start gap-2 rounded px-2 py-2 hover:bg-surface-2"
                >
                  <MessageSquare size={13} className="mt-0.5 shrink-0 text-text-muted" />

                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate', session.firstPrompt ? 'text-text-primary' : 'text-text-muted italic')}>
                      {session.firstPrompt ?? 'No opening prompt recorded'}
                    </p>
                    <p className="tabular flex items-center gap-2 text-[12.5px] text-text-muted">
                      <span className="font-mono">{session.sessionId.slice(0, 8)}</span>
                      <span>{sizeLabel(session.sizeBytes)}</span>
                      <span>{relativeTime(session.modifiedAt) || 'unknown'} ago</span>
                      {session.active ? (
                        <span className="flex items-center gap-1 text-warn">
                          <TriangleAlert size={11} /> probably open elsewhere
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() => void adopt(session)}
                  >
                    {busy === session.sessionId ? (
                      <Loader size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    Import
                  </Button>
                </div>
              ))
            )}
          </div>

          <footer className="border-t border-border-subtle px-4 py-2 text-[12.5px] leading-4 text-text-muted">
            A session marked <span className="text-warn">open elsewhere</span> can be imported and read
            safely, but sending a message from here while it is live elsewhere will conflict — close it
            there first.
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
