/**
 * Pseudo-terminals — one per open terminal in the UI.
 *
 * THIS SHELL IS YOURS, NOT THE AGENT'S. Nothing here is reachable from a chat: the agent runs
 * commands through its own Bash tool and their output appears as a tool card. Keeping the two apart
 * means a wedged terminal cannot affect a run, and a run cannot type into your shell.
 *
 * The only genuinely hard part is disposal. A PTY is an OS process: if a browser tab closes, or the
 * app is reloaded, or a socket dies mid-command, the shell keeps running with nobody attached. Every
 * exit path below therefore ends at `dispose`, and the process list is walked on shutdown.
 */
import { spawn, type IPty } from 'node-pty';
import type { ShellProfile } from '@shared/types';

/** Enough history to scroll back through a build, not enough to hold a gigabyte of log. */
export const SCROLLBACK_LIMIT = 5000;

interface Session {
  pty: IPty;
  /** Cleanup runs once, from whichever path gets there first. */
  disposed: boolean;
}

const sessions = new Map<string, Session>();

export interface PtyHandlers {
  onData: (chunk: string) => void;
  onExit: (code: number) => void;
}

/**
 * Start a shell in `cwd`.
 *
 * `id` is the caller's handle (one per socket). Starting a second session with an id already in use
 * disposes the first — a reconnecting client must not leak the shell it abandoned.
 */
export function start(
  id: string,
  cwd: string,
  profile: ShellProfile,
  handlers: PtyHandlers,
  cols = 80,
  rows = 24
): void {
  dispose(id);

  const pty = spawn(profile.path, profile.args, {
    cwd,
    cols,
    rows,
    // What xterm.js advertises; anything less and colour output arrives as escape soup.
    name: 'xterm-256color',
    env: { ...process.env } as Record<string, string>
  });

  const session: Session = { pty, disposed: false };
  sessions.set(id, session);

  pty.onData((chunk) => handlers.onData(chunk));
  pty.onExit(({ exitCode }) => {
    session.disposed = true;
    sessions.delete(id);
    handlers.onExit(exitCode);
  });
}

export function write(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session || session.disposed) return;
  try {
    session.pty.write(data);
  } catch {
    // The shell can exit between a keystroke arriving and being written; the exit handler already
    // told the client, so there is nothing useful to add here.
  }
}

export function resize(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session || session.disposed) return;
  // A zero or negative dimension throws inside ConPTY rather than being ignored.
  if (cols < 1 || rows < 1) return;
  try {
    session.pty.resize(cols, rows);
  } catch {
    /* same race as write */
  }
}

/**
 * Kill a session's shell.
 *
 * Wrapped because ConPTY throws when the console behind the PTY has already gone — a shell that
 * exited on its own, or a child that took the console with it. That throw is not a failure worth
 * propagating: the process we wanted gone is gone.
 */
export function dispose(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.disposed) return;
  session.disposed = true;
  try {
    session.pty.kill();
  } catch {
    /* console already gone */
  }
}

export function disposeAll(): void {
  for (const id of [...sessions.keys()]) dispose(id);
}

export function count(): number {
  return sessions.size;
}
