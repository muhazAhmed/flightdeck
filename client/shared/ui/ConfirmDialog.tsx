import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './Button';

export interface ConfirmRequest {
  title: string;
  /** One sentence on what will happen. Say the consequence, not "are you sure". */
  description: string;
  /** Paths the action applies to. Always shown, so the user confirms a specific set
   *  rather than a vague count. */
  files: string[];
  confirmLabel: string;
  /** `danger` for anything unrecoverable — currently only discard. */
  tone?: 'default' | 'danger';
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;
  onClose: () => void;
}

const MAX_LISTED = 12;

/**
 * One dialog for every source-control action.
 *
 * Staging is reversible and discard is not, but both go through here: the value of a
 * consistent gate is that no action in this panel ever happens on a single mis-click, and
 * the file list means you always see exactly what you are about to touch.
 */
export function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const files = request?.files ?? [];
  const overflow = files.length - MAX_LISTED;

  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-1 p-4 shadow-[var(--shadow-popover)]">
          <Dialog.Title className="mb-1 font-medium">{request?.title}</Dialog.Title>
          <Dialog.Description className="mb-3 text-[12.5px] leading-4 text-text-secondary">
            {request?.description}
          </Dialog.Description>

          <ul className="mb-4 max-h-44 overflow-y-auto rounded bg-surface-2 p-2">
            {files.slice(0, MAX_LISTED).map((file) => (
              <li key={file} className="truncate font-mono text-[12.5px] text-text-secondary" title={file}>
                {file}
              </li>
            ))}
            {overflow > 0 ? (
              <li className="tabular pt-1 font-mono text-[12.5px] text-text-muted">
                and {overflow} more…
              </li>
            ) : null}
          </ul>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={request?.tone === 'danger' ? 'danger' : 'primary'}
              size="sm"
              autoFocus
              onClick={() => {
                request?.onConfirm();
                onClose();
              }}
            >
              {request?.confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
