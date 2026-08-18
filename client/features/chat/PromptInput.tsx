import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CircleStop, CornerDownLeft, FolderTree } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/lib/cn';

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

export function PromptInput({ running, draft, onDraftConsumed, onSend, onStop }: PromptInputProps) {
  const [value, setValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

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

  function submit() {
    const text = value.trim();
    if (!text || running) return;
    onSend(text);
    setValue('');
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter sends; plain Enter inserts a newline. Prompts here are routinely several
    // lines, and losing one to a stray Enter is infuriating.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  /** Insert a path placeholder rather than pasting file contents: cheaper in context, and it
   *  cannot be truncated the way a long paste can. */
  function insertPathHint() {
    const el = textarea.current;
    const addition = value.trim() ? ' ' : '';
    setValue((current) => `${current}${addition}`);
    requestAnimationFrame(() => {
      el?.focus();
      resize();
    });
  }

  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface-1 px-4 py-3">
      <div
        className={cn(
          'rounded-lg border bg-surface-2 transition-colors duration-(--duration-fast)',
          'border-border-default focus-within:border-accent'
        )}
      >
        <textarea
          ref={textarea}
          value={value}
          rows={2}
          placeholder="Describe what you want changed…"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-5.5 text-text-primary placeholder:text-text-muted focus:outline-none"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <IconButton
            label="Reference a file by path instead of pasting it"
            icon={<FolderTree size={14} />}
            onClick={insertPathHint}
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
              <Button variant="primary" size="sm" onClick={submit} disabled={!value.trim()}>
                Send <CornerDownLeft size={13} />
              </Button>
            )}
          </span>
        </div>
      </div>

      <p className="mt-2 text-center text-[11.5px] text-text-muted">
        Naming exact files and what "done" looks like gets better results than a general request.
      </p>
    </div>
  );
}
