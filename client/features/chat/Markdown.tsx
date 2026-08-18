import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

/**
 * Assistant prose, rendered as markdown.
 *
 * The agent writes markdown — headings, bold, inline code, lists, tables — and rendering it as
 * plain text meant reading literal `##` and `**` in the transcript. Every element below is styled
 * from the design tokens rather than left to browser defaults, which would arrive with white
 * headings, blue links and serif blockquotes.
 *
 * PERFORMANCE: this component is memoised on its text, and each text block in a transcript is a
 * separate instance. While a response streams, only the final block's markdown is re-parsed on each
 * animation frame; everything above it is untouched. That is what keeps a long conversation from
 * re-parsing itself sixty times a second.
 */
interface MarkdownProps {
  children: string;
}

/** Sizes step down but stay close: this is chat prose, not a document, and an h1 that dwarfs the
 *  surrounding text breaks the reading rhythm. */
const HEADING = 'font-semibold tracking-tight text-text-primary';

function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      // Local tool, but a model can still emit a remote link; opening it must not replace the app.
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent-bright underline decoration-accent-bright/40 underline-offset-2 hover:decoration-accent-bright"
    >
      {children}
    </a>
  );
}

function Code({ className, children }: { className?: string; children?: ReactNode }) {
  // react-markdown marks fenced blocks with a `language-*` class; anything else is inline.
  const isBlock = typeof className === 'string' && className.startsWith('language-');
  if (isBlock) {
    return <code className={cn('font-mono text-[12.5px] leading-5', className)}>{children}</code>;
  }
  return (
    <code className="rounded border border-border-subtle bg-surface-3 px-1 py-0.5 font-mono text-[12.5px] text-text-primary">
      {children}
    </code>
  );
}

export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  return (
    <div className="text-[14px] leading-[1.6] text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className={cn(HEADING, 'mt-5 mb-2 text-[17px] first:mt-0')}>{children}</h1>,
          h2: ({ children }) => <h2 className={cn(HEADING, 'mt-5 mb-2 text-[16px] first:mt-0')}>{children}</h2>,
          h3: ({ children }) => <h3 className={cn(HEADING, 'mt-4 mb-1.5 text-[14.5px] first:mt-0')}>{children}</h3>,
          h4: ({ children }) => (
            <h4 className={cn(HEADING, 'mt-4 mb-1.5 text-[14px] text-text-secondary first:mt-0')}>{children}</h4>
          ),

          p: ({ children }) => <p className="my-2.5 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
          em: ({ children }) => <em className="italic text-text-secondary">{children}</em>,
          del: ({ children }) => <del className="text-text-muted line-through">{children}</del>,

          ul: ({ children }) => <ul className="my-2.5 ml-4 list-disc space-y-1 first:mt-0 last:mb-0">{children}</ul>,
          ol: ({ children }) => (
            <ol className="my-2.5 ml-4 list-decimal space-y-1 first:mt-0 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="marker:text-text-muted">{children}</li>,

          a: Anchor,
          code: Code,
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-md border border-border-subtle bg-(--bg-base) p-3 first:mt-0 last:mb-0">
              {children}
            </pre>
          ),

          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-3 text-text-secondary">{children}</blockquote>
          ),
          hr: () => <hr className="my-4 border-border-subtle" />,

          // Tables need to scroll rather than force the panel wider — the middle column is already
          // the narrowest thing on screen when both side panels are open.
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
          th: ({ children }) => (
            <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border-subtle px-2 py-1.5 align-top">{children}</td>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
