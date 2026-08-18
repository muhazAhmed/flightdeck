import { ClipboardCheck, Code2, Lightbulb, MessagesSquare, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project } from '@shared/types';

interface Suggestion {
  icon: ReactNode;
  title: string;
  hint: string;
  /** The prompt this card puts in the input. Written as an instruction the agent can act on
   *  immediately — a card that only types a topic makes the user do the work twice. */
  prompt: string;
  tone: string;
}

/**
 * Suggestions are real prompts, not decoration. Each one is phrased for this tool's loop: the
 * agent edits the working tree, you review the diff, you commit — so "write the commit message
 * for what is already staged" is useful, while "write code for me" is not a starting point.
 */
const SUGGESTIONS: Suggestion[] = [
  {
    icon: <Sparkles size={16} />,
    title: 'Commit message',
    hint: 'Describe what is staged',
    prompt:
      'Read the staged diff (git diff --staged) and write a commit message for it. Subject line under 72 characters, then a short body explaining why. Output only the message — do not run git commit.',
    tone: 'text-accent-bright'
  },
  {
    icon: <ClipboardCheck size={16} />,
    title: 'Review changes',
    hint: 'Critique the current diff',
    prompt:
      'Review my uncommitted changes (git diff and git diff --staged). Point out bugs, missed edge cases and anything inconsistent with the surrounding code. Do not change any files — just tell me what you find.',
    tone: 'text-info'
  },
  {
    icon: <Code2 size={16} />,
    title: 'Explain this repo',
    hint: 'Architecture and entry points',
    prompt:
      'Give me a map of this repository: entry points, how the main pieces fit together, where state lives, and anything surprising a new contributor would trip over. Read-only.',
    tone: 'text-success'
  },
  {
    icon: <Lightbulb size={16} />,
    title: 'Find the risk',
    hint: 'What is most likely to break',
    prompt:
      'Look through this project for the code most likely to cause a production incident — unhandled errors, missing validation, silent failures, unsafe defaults. Rank what you find by how bad the failure would be. Do not fix anything yet.',
    tone: 'text-warn'
  }
];

interface ChatEmptyStateProps {
  project: Project;
  onPick: (prompt: string) => void;
}

export function ChatEmptyState({ project, onPick }: ChatEmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-12 text-center">
      <span className="mb-5 flex size-14 items-center justify-center rounded-xl border border-border-subtle bg-surface-2 text-text-muted">
        <MessagesSquare size={24} />
      </span>

      <h3 className="text-[19px] font-semibold tracking-tight">How can I help with {project.name}?</h3>
      <p className="mt-1.5 text-[13.5px] leading-5 text-text-secondary">
        Describe a change, ask for a review, or ask how something works.
      </p>
      <p className="mt-1 text-[12.5px] text-text-muted">
        Files are edited in place — nothing is committed until you do it yourself.
      </p>

      <div className="mt-7 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            onClick={() => onPick(suggestion.prompt)}
            className="group flex flex-col items-start gap-1 rounded-lg border border-border-subtle bg-surface-2 p-3 text-left transition-colors duration-(--duration-fast) hover:border-border-default hover:bg-surface-3"
          >
            <span className={suggestion.tone}>{suggestion.icon}</span>
            <span className="text-[13.5px] font-medium">{suggestion.title}</span>
            <span className="text-[12px] leading-4 text-text-muted">{suggestion.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
