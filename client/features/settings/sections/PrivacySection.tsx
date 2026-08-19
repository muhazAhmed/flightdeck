import { useCallback, useEffect, useState } from 'react';
import { Copy, HardDrive, Lock, Trash2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import type { StorageUsage } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import type { ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { IconButton } from '@/shared/ui/IconButton';
import { detailOf, messageOf } from '@/lib/http';
import { storageApi } from '../api';
import { Card } from '../controls/Card';
import { Row } from '../controls/Row';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

interface PrivacySectionProps {
  onConfirm: (request: ConfirmRequest) => void;
}

/**
 * What is on disk, named rather than described.
 *
 * "Attachments are stored locally" is a claim; the real path, the file count and a delete button are
 * facts you can check and act on. The numbers come from the server because it is the only side that
 * can see the directory.
 */
export function PrivacySection({ onConfirm }: PrivacySectionProps) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsage(await storageApi.usage());
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const purge = useCallback(async () => {
    setBusy(true);
    try {
      const result = await storageApi.purgeAttachments();
      toast.success(
        result.deleted === 0 ? 'There was nothing to delete' : `Deleted ${result.deleted} attachments`,
        { description: result.freedBytes > 0 ? `Freed ${formatBytes(result.freedBytes)}` : undefined }
      );
      await load();
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    } finally {
      setBusy(false);
    }
  }, [load]);

  return (
    <>
      <Card title="What leaves this machine" icon={<WifiOff size={14} />}>
        <p className="text-[13px] leading-5 text-text-secondary">
          Flight Deck makes no network calls of its own — no telemetry, no analytics, no update checks.
          The only outbound traffic is whatever the <span className="font-mono">claude</span> CLI and{' '}
          <span className="font-mono">git</span> do on your behalf, with the accounts you already
          configured for them.
        </p>
        <p className="mt-2 text-[12.5px] leading-5 text-text-muted">
          The server listens on <span className="font-mono">127.0.0.1</span> and has no
          authentication, because it is not meant to be reachable. Do not expose the port.
        </p>
      </Card>

      <Card title="On disk" icon={<HardDrive size={14} />}>
        <Row label="Projects, chats and preferences" hint="One JSON file. Your repositories are never written to.">
          <PathChip path={usage?.stateFile} />
        </Row>
        <Row
          label="Attachments"
          hint="Pasted screenshots and dropped files, kept so the agent can read them by path. They are not encrypted."
        >
          <PathChip path={usage?.attachmentsDir} />
        </Row>
        <Row
          label={
            usage
              ? `${usage.attachmentCount} file${usage.attachmentCount === 1 ? '' : 's'} · ${formatBytes(usage.attachmentBytes)}`
              : 'Measuring…'
          }
          hint="Deleting these does not edit past prompts — a transcript still shows the path a file used to be at."
        >
          <Button
            variant="danger"
            size="sm"
            disabled={busy || !usage || usage.attachmentCount === 0}
            onClick={() =>
              onConfirm({
                title: 'Delete every attachment?',
                description:
                  'Removes all pasted and dropped files from disk. Prompts that referenced them keep the path in their text, so an old chat may point at a file that no longer exists. Projects, chats and settings are untouched.',
                files: [usage?.attachmentsDir ?? 'attachments'],
                confirmLabel: 'Delete all',
                tone: 'danger',
                onConfirm: () => void purge()
              })
            }
          >
            <Trash2 size={13} />
            Delete all
          </Button>
        </Row>
      </Card>

      <Card title="Transcripts belong to the CLI" icon={<Lock size={14} />} muted>
        <p className="text-[13px] leading-5 text-text-muted">
          Chat history is read from Claude Code's own transcript files rather than copied into Flight
          Deck, so there is no second archive of your conversations here to delete. Clearing them means
          clearing them where the CLI keeps them.
        </p>
      </Card>
    </>
  );
}

function PathChip({ path }: { path?: string }) {
  if (!path) return <span className="text-[13px] text-text-muted">—</span>;
  return (
    <span className="flex max-w-72 items-center gap-1">
      <span className="truncate font-mono text-[12px] text-text-secondary" title={path}>
        {path}
      </span>
      <IconButton
        label="Copy path"
        icon={<Copy size={12} />}
        onClick={() => {
          void navigator.clipboard.writeText(path);
          toast.success('Path copied');
        }}
      />
    </span>
  );
}
