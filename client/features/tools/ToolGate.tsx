import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Copy, ExternalLink, KeyRound, RefreshCw, Terminal } from 'lucide-react';
import type { ToolId, ToolStatus } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { Skeleton } from '@/shared/ui/Skeleton';
import { useWorkspace } from '@/store/workspace';
import { useTools } from './useTools';

interface ToolGateProps {
  /** Whichever tools this feature cannot work without. */
  requires: ToolId[];
  /** Rendered only once every requirement is installed and, where it has a login, signed in. */
  children: (tools: ToolStatus[]) => ReactNode;
}

/**
 * Stands in front of a feature that needs a tool Flight Deck does not ship.
 *
 * ASKED HERE, NOT AT INSTALL TIME. Nobody reads a dependency list before they need it, and a check at
 * launch announces a tool you may never use. This is the empty state teaching you at the one moment you
 * care — and it is why the sidebar button stays enabled: a disabled button with a tooltip is a dead end,
 * while the same click lands somewhere that explains itself and offers the fix.
 *
 * Nothing is installed behind anyone's back. Installing types the official command into the terminal on this
 * page, where you can read it, watch it and stop it. Consent is the press; the command is visible.
 */
export function ToolGate({ requires, children }: ToolGateProps) {
  const { tools, loading, checks, error, recheck, signIn } = useTools(true);

  // A failed check is a state with a way out of it, not a skeleton that never resolves.
  if (!tools && error) {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center p-6">
        <section className="w-full max-w-lg rounded-lg border border-border-default bg-surface-1 p-4">
          <h2 className="text-[15px] font-medium">Could not check what this machine has</h2>
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11.5px] whitespace-pre-wrap text-text-secondary">
            {error}
          </pre>
          <Button className="mt-3" size="sm" variant="secondary" disabled={loading} onClick={() => void recheck()}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            {loading ? 'Checking…' : 'Try again'}
          </Button>
        </section>
      </div>
    );
  }

  if (!tools) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const needed = requires
    .map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is ToolStatus => tool !== undefined);
  const blocking = needed.filter((tool) => !tool.installed || tool.authenticated === false);

  if (blocking.length === 0) return <>{children(needed)}</>;

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-lg flex-col gap-3">
        {blocking.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            checks={checks}
            loading={loading}
            onRecheck={() => void recheck()}
            onSignIn={signIn}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One tool's not-ready state. Exported so it can be rendered against every state a real machine produces
 * without standing up the fetch the gate does on mount.
 */
export function ToolCard({
  tool,
  checks,
  loading,
  onRecheck,
  onSignIn
}: {
  tool: ToolStatus;
  checks: number;
  loading: boolean;
  onRecheck: () => void;
  /** Hand a token over. Resolves false when it was refused, so the field can keep it for a second try. */
  onSignIn?: (token: string) => Promise<boolean>;
}) {
  const runInTerminal = useWorkspace((s) => s.runInTerminal);
  /*
   * The command runs on THIS page, and the page it is on must host a terminal.
   *
   * The first version switched to the workspace view first, because that is where the terminal lived. Pressing
   * "install" then threw the reader out of the page they were reading and into whichever project happened to
   * be open — the install ran and the UI still felt broken. `runInTerminal` opens the terminal wherever the
   * current page renders it; nothing here navigates.
   */
  const selectedProjectId = useWorkspace((s) => s.selectedProjectId);
  // Installed but not signed in is a different problem with a different fix, and telling that user to install
  // what they already have is how a check loses their trust.
  const step = tool.installed ? 'auth' : 'install';
  const command = step === 'auth' ? tool.authCommand : tool.installCommand;

  return (
    <section className="rounded-lg border border-border-default bg-surface-1 p-4">
      <h2 className="text-[15px] font-medium">
        {step === 'auth' ? `${tool.label} is not signed in` : `${tool.label} is not installed`}
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-text-secondary">
        {tool.purpose}{' '}
        {step === 'auth'
          ? 'It is here, but not logged in to GitHub yet — which fails as a permission error rather than a missing command.'
          : 'Flight Deck does not install it for you; the command below is the official one for this machine.'}
      </p>

      {step === 'auth' ? (
        <SignInWithToken tool={tool} loading={loading} onSignIn={onSignIn} />
      ) : command ? (
        <>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-primary">{command}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(command);
                toast.success('Command copied');
              }}
            >
              <Copy size={12} />
              Copy
            </Button>
          </div>
          <p className="mt-2 text-[12px] leading-4 text-text-muted">
            {/* Named, because the command differs per OS and per manager — and an unexplained command is one
                you have to go and verify before you trust it. */}
            {tool.installManager ? `Using ${tool.installManager}, which is what this machine has. ` : ''}
            Runs in the terminal at the bottom of this page, where you can read it and stop it. Nothing is
            installed in the background.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[13px] leading-5 text-warn">
          No package manager we recognise is on this machine, so there is no single command to offer — the
          official instructions cover every platform.
        </p>
      )}

      {/* The tool's own words, never paraphrased. */}
      {tool.detail ? (
        <pre className="mt-3 max-h-32 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11.5px] whitespace-pre-wrap text-text-secondary">
          {tool.detail}
        </pre>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {command ? (
          <Button
            size="sm"
            /* Secondary once there is a form above it: the CLI's own flow is for someone who prefers it, not
               the path everyone should be pushed down. */
            variant={step === 'auth' ? 'ghost' : 'primary'}
            // A shell opens in a project's folder, so without one there is nowhere to type this.
            disabled={selectedProjectId === null}
            title={selectedProjectId === null ? 'Select a project first — the terminal opens in one' : undefined}
            onClick={() => runInTerminal(command)}
          >
            <Terminal size={13} />
            {step === 'auth' ? `Or run ${command} in the terminal` : 'Install it, in the terminal'}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={loading} onClick={onRecheck}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
          {loading ? 'Checking…' : 'Check again'}
        </Button>
        <a
          href={tool.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-[12.5px] text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          <ExternalLink size={12} />
          Installation docs
        </a>
      </div>

      {/*
        THE FAILURE THIS FEATURE IS MOST LIKELY TO PRODUCE, so it is said rather than left to be discovered.
        A process gets the PATH it started with: `winget install` updates the registry, not the environment of
        a running Node server, and a new shell inherits the server's environment rather than a fresh one. So
        the tool is genuinely installed and genuinely invisible until Flight Deck restarts. Shown only after an
        actual re-check, where it is an explanation rather than a warning about nothing.
      */}
      {checks > 0 && step === 'install' ? (
        <p className="mt-3 flex items-start gap-1.5 rounded bg-warn/10 px-2 py-1.5 text-[12px] leading-4 text-warn">
          <Check size={12} className="mt-0.5 shrink-0" />
          <span>
            Already installed it? Restart Flight Deck. A running process keeps the PATH it started with, so a
            tool installed a minute ago is invisible to this server — and to any shell it opens — until then.
          </span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Sign in by pasting a token.
 *
 * WHY THIS REPLACED THE DEVICE-CODE FLOW, reported from use: driving `gh auth login` through the embedded
 * terminal cannot be made reliable by presenting it better. The one-time code has to be copied out of a
 * terminal, where `Ctrl+C` is SIGINT rather than copy; the CLI has to stay alive through a browser round trip
 * it does not own; and an interrupted attempt is indistinguishable from a rejected one — authorise in the
 * browser a moment after the CLI has died and nothing happens at all, with nothing on screen to say why. That
 * is exactly what happened. One field and one button has none of those failure modes, and works over a
 * connection where nothing can open a browser at all.
 *
 * The token never belongs to Flight Deck: it is posted once, handed to `gh` on stdin, and stored by gh in the
 * system credential store. Nothing writes it to `state.json`, logs it, or sends it back.
 */
function SignInWithToken({
  tool,
  loading,
  onSignIn
}: {
  tool: ToolStatus;
  loading: boolean;
  onSignIn?: (token: string) => Promise<boolean>;
}) {
  const [token, setToken] = useState('');

  const submit = async () => {
    if (!onSignIn || token.trim() === '') return;
    const ok = await onSignIn(token.trim());
    // Cleared only on success. Wiping a rejected token means retyping the whole thing to fix one character.
    if (ok) setToken('');
  };

  return (
    <div className="mt-3 rounded-md border border-border-subtle bg-surface-2 p-3">
      <ol className="flex flex-col gap-1.5 text-[12.5px] leading-5 text-text-secondary">
        <li className="flex flex-wrap items-center gap-1.5">
          <span className="text-text-muted">1.</span>
          {tool.tokenUrl ? (
            <a
              href={tool.tokenUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent-bright hover:underline"
            >
              <ExternalLink size={12} />
              Create a token on GitHub
            </a>
          ) : (
            <span>Create a personal access token on GitHub</span>
          )}
          {/* The link prefills the scopes, so this says what you are agreeing to rather than sending you to
              find out which boxes to tick. */}
          <span className="text-text-muted">— scopes already ticked: repo, read:org, gist</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-text-muted">2.</span>
          <span>Paste it here. No codes to copy out of a terminal.</span>
        </li>
      </ol>

      <div className="mt-3 flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded border border-border-default bg-(--bg-base) px-2">
          <KeyRound size={12} className="shrink-0 text-text-muted" />
          <input
            // A password field: a token in plain sight is a token in the next screenshot.
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder="ghp_…"
            spellCheck={false}
            autoComplete="off"
            aria-label="GitHub personal access token"
            className="h-8 w-full bg-transparent font-mono text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </span>
        <Button size="sm" variant="primary" disabled={loading || token.trim() === ''} onClick={() => void submit()}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>

      <p className="mt-2 text-[11.5px] leading-4 text-text-muted">
        The token goes straight to the GitHub CLI, which keeps it in your system credential store. Flight Deck
        does not store a copy.
      </p>
    </div>
  );
}
