import { useRef, useState, type KeyboardEvent } from 'react';
import { CircleStop, CornerDownLeft } from 'lucide-react';
import { Button } from '@/shared/ui/Button';

interface PromptInputProps {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_ROWS = 12;

export function PromptInput({ running, onSend, onStop }: PromptInputProps) {
  const [value, setValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS * lineHeight)}px`;
  }

  function submit() {
    const text = value.trim();
    if (!text || running) return;
    onSend(text);
    setValue('');
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter sends; plain Enter inserts a newline, because prompts here are often
    // several lines and losing one to a stray Enter is infuriating.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-border-subtle bg-surface-1 p-2.5">
      <div className="rounded-md border border-border-default bg-surface-2 focus-within:border-accent">
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
          className="block w-full resize-none bg-transparent px-2.5 py-2 text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div className="flex items-center justify-between px-2.5 pb-2">
          <span className="text-[12.5px] text-text-muted">
            <kbd className="font-mono">Ctrl</kbd> + <kbd className="font-mono">Enter</kbd> to send
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
        </div>
      </div>
    </div>
  );
}
