import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { CircleStop, CornerDownLeft, Image as ImageIcon, Loader, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Attachment } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';
import { detailOf, messageOf } from '@/lib/http';
import { attachmentApi } from './api';
import { filterCommands, SlashMenu, slashQuery, useSlashCommands } from './SlashMenu';

interface PromptInputProps {
  /** Which project's commands and skills to offer. Null disables the slash menu. */
  projectId: string | null;
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

export function PromptInput({ projectId, running, draft, onDraftConsumed, onSend, onStop }: PromptInputProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const allCommands = useSlashCommands(projectId);
  // Dismissed for the current token: typing `/` again reopens, so Escape is not a permanent off switch.
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const query = slashQuery(value);
  const matches = query === null || slashDismissed ? [] : filterCommands(allCommands, query);
  const slashOpen = matches.length > 0;
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

  /** Put the chosen command in the box with a trailing space, ready for its arguments. */
  function pick(name: string) {
    setValue(`/${name} `);
    setSlashDismissed(true);
    setSlashIndex(0);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      resize();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    /*
     * The slash menu owns these keys while it is open, and Enter is the one that matters: now that Enter sends,
     * an unguarded Enter would fire off `/dep` as a prompt instead of completing it to `/deploy`.
     */
    if (slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashIndex((index) => (index + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex((index) => (index - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = matches[Math.min(slashIndex, matches.length - 1)];
        if (chosen) {
          event.preventDefault();
          pick(chosen.name);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (event.key !== 'Enter') return;

    /*
     * An IME is mid-composition: this Enter is confirming a candidate, not finishing a sentence. Sending here
     * would swallow the word being typed, and it is the one Enter case that has nothing to do with intent.
     */
    if (event.nativeEvent.isComposing) return;

    // Shift+Enter is the newline. Alt+Enter too, because some keyboard layouts make Shift+Enter awkward.
    if (event.shiftKey || event.altKey) return;

    // Enter sends, and Ctrl/Cmd+Enter keeps working for the muscle memory it built.
    event.preventDefault();
    submit();
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
          'relative rounded-lg border bg-surface-2 transition-colors duration-(--duration-fast)',
          dragging ? 'border-accent bg-accent-subtle' : 'border-border-default focus-within:border-accent'
        )}
      >
        {slashOpen ? (
          <SlashMenu
            commands={matches}
            activeIndex={Math.min(slashIndex, matches.length - 1)}
            onPick={(command) => pick(command.name)}
            onHover={setSlashIndex}
          />
        ) : null}
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
            const next = event.target.value;
            // A new slash token reopens the menu; anything else leaves the dismissal alone.
            if (slashQuery(next) === '') setSlashDismissed(false);
            setValue(next);
            setSlashIndex(0);
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
            {/* The affordance people need is the one that is NOT obvious: Enter sending is discovered on the
                first message, whereas Shift+Enter has to be told. */}
            <span className="text-[11.5px] text-text-muted">
              <kbd className="font-mono">Shift</kbd> + <kbd className="font-mono">Enter</kbd> for a new line
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
