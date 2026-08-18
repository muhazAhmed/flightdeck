import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { CircleStop, CornerDownLeft, Image as ImageIcon, Loader, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Attachment } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { detailOf, messageOf } from '@/lib/http';
import { attachmentApi } from './api';

interface PromptInputProps {
  running: boolean;
  /** Text pushed in from elsewhere (a suggestion card). Loaded for editing, not sent. */
  draft: string | null;
  onDraftConsumed: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

const LINE_HEIGHT = 22;
const MAX_ROWS = 14;

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function PromptInput({ running, draft, onDraftConsumed, onSend, onStop }: PromptInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  function resize() {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS * LINE_HEIGHT)}px`;
  }

  // A suggestion lands in the box focused and editable — never sent on the user's behalf.
  useEffect(() => {
    if (draft === null) return;
    setValue(draft);
    onDraftConsumed();
    requestAnimationFrame(() => {
      resize();
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [draft, onDraftConsumed]);

  /**
   * Save files to disk and keep their paths.
   *
   * A browser never reveals where a dropped file came from, so the bytes are written to
   * `~/.flightdeck/attachments/` and the agent reads them from there with its own Read tool —
   * which handles images as well as text.
   */
  async function attach(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const attachment = await attachmentApi.upload(file);
        setAttachments((current) => [...current, attachment]);
      } catch (err) {
        toast.error(`Could not attach ${file.name}`, { description: detailOf(err) ?? messageOf(err) });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    textarea.current?.focus();
  }

  /** Paste a screenshot straight in — the common case, and the one with no file to pick. */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    void attach(files);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void attach(event.dataTransfer.files);
  }

  /**
   * Compose the message. Attachment paths are appended as an explicit block rather than pasted
   * contents: the agent reads what it needs, nothing is truncated, and a 2 MB screenshot does not
   * become 2 MB of context.
   */
  function submit() {
    const text = value.trim();
    if ((!text && attachments.length === 0) || running) return;

    const body =
      attachments.length === 0
        ? text
        : [
            text,
            '',
            attachments.length === 1 ? 'Attached file:' : 'Attached files:',
            ...attachments.map((a) => `- ${a.path}`)
          ]
            .join('\n')
            .trim();

    onSend(body);
    setValue('');
    setAttachments([]);
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter sends; plain Enter inserts a newline. Prompts here are routinely several lines,
    // and losing one to a stray Enter is infuriating.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  const busy = uploading > 0;

  return (
    <div
      className="shrink-0 border-t border-border-subtle bg-surface-1 px-4 py-3"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div
        className={cn(
          'rounded-lg border bg-surface-2 transition-colors duration-(--duration-fast)',
          dragging ? 'border-accent bg-accent-subtle' : 'border-border-default focus-within:border-accent'
        )}
      >
        {attachments.length > 0 || busy ? (
          <div className="flex flex-wrap gap-1.5 border-b border-border-subtle px-2.5 py-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.path}
                className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-3 py-1 pr-1 pl-2 text-[12px]"
                title={attachment.path}
              >
                {attachment.kind === 'image' ? (
                  <ImageIcon size={12} className="shrink-0 text-accent-bright" />
                ) : (
                  <Paperclip size={12} className="shrink-0 text-text-muted" />
                )}
                <span className="max-w-48 truncate">{attachment.name}</span>
                <span className="tabular text-text-muted">{sizeLabel(attachment.sizeBytes)}</span>
                <IconButton
                  label={`Remove ${attachment.name}`}
                  tone="danger"
                  icon={<X size={11} />}
                  onClick={() => setAttachments((current) => current.filter((a) => a.path !== attachment.path))}
                />
              </span>
            ))}
            {busy ? (
              <span className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-text-muted">
                <Loader size={12} className="animate-spin" /> saving {uploading}…
              </span>
            ) : null}
          </div>
        ) : null}

        <textarea
          ref={textarea}
          value={value}
          rows={2}
          placeholder={dragging ? 'Drop files to attach…' : 'Describe what you want changed…'}
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-5.5 text-text-primary placeholder:text-text-muted focus:outline-none"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={filePicker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void attach(event.target.files);
              event.target.value = '';
            }}
          />
          <IconButton
            label="Attach files or images — or just paste a screenshot"
            icon={<Paperclip size={14} />}
            disabled={busy}
            onClick={() => filePicker.current?.click()}
          />

          <span className="ml-auto flex items-center gap-2.5">
            <span className="text-[11.5px] text-text-muted">
              <kbd className="font-mono">Ctrl</kbd> + <kbd className="font-mono">Enter</kbd>
            </span>
            {running ? (
              <Button variant="danger" size="sm" onClick={onStop}>
                <CircleStop size={13} /> Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={submit}
                disabled={busy || (!value.trim() && attachments.length === 0)}
              >
                Send <CornerDownLeft size={13} />
              </Button>
            )}
          </span>
        </div>
      </div>

      <p className="mt-2 text-center text-[11.5px] text-text-muted">
        Paste or drop images and files to attach them. For files already in the project, typing the
        path is cheaper than attaching a copy.
      </p>
    </div>
  );
}
