/**
 * Pseudo-terminals — one per project, outliving the socket that opened it.
 *
 * THIS SHELL IS YOURS, NOT THE AGENT'S. Nothing here is reachable from a chat: the agent runs
 * commands through its own Bash tool and their output appears as a tool card. Keeping the two apart
 * means a wedged terminal cannot affect a run, and a run cannot type into your shell.
 *
 * WHY SESSIONS PERSIST. They used to be keyed per socket and disposed the moment it closed, on the
 * grounds that a shell nobody is attached to is a leak. That was wrong for the thing people actually do
 * with this terminal: start a dev server, switch to another project, come back. Switching projects
 * remounts the terminal, which closed the socket, which killed the server that had just been started —
 * and starting one in the second project looked like it had taken over the first.
 *
 * So a session is keyed by project and survives detachment. What made the old rule right is kept: the
 * shells are still walked and killed on shutdown, and each is visible in the project it belongs to with
 * an explicit stop. A process you started and can see is not a leak; one nobody can reach is.
 */
import { spawn, type IPty } from 'node-pty';
import type { ShellProfile } from '@shared/types';

/** Enough history to scroll back through a build, not enough to hold a gigabyte of log. */
export const SCROLLBACK_LIMIT = 5000;

/**
 * How much output is kept for a client that reattaches.
 *
 * Bytes rather than lines, because a line of build output can be any length and this is a memory bound.
 * Half a megabyte is a few thousand ordinary lines — enough to see what a dev server printed while you
 * were in another project, and small enough that twenty idle sessions cost ten megabytes at worst.
 */
const BUFFER_BYTES = 512 * 1024;

interface Session {
  pty: IPty;
  /** Which shell this is, so a profile change restarts rather than silently reusing the old one. */
  profileId: string;
  /** Recent output, replayed when a client attaches. */
  buffer: string;
  /**
   * The attached client, or null while nothing is watching.
   *
   * A session with no handlers keeps running and keeps buffering; that is the entire point.
   */
  handlers: PtyHandlers | null;
  /** Cleanup runs once, from whichever path gets there first. */
  disposed: boolean;
}

const sessions = new Map<string, Session>();

export interface PtyHandlers {
  onData: (chunk: string) => void;
  onExit: (code: number) => void;
}

function remember(session: Session, chunk: string): void {
  session.buffer += chunk;
  if (session.buffer.length > BUFFER_BYTES) {
    // Trimmed from the front: the recent end is the useful end.
    session.buffer = session.buffer.slice(session.buffer.length - BUFFER_BYTES);
  }
}

export interface AttachResult {
  /** True when an existing shell was reused rather than started. */
  restored: boolean;
  /** Output produced while nothing was attached, or since the shell started. */
  history: string;
}

/**
 * Attach to a project's shell, starting one if there is none.
 *
 * `key` is the project id, so the same project always gets the same shell. A second client attaching takes
 * over rather than sharing: two windows writing into one PTY reads as a haunted terminal.
 *
 * Passing a different `profile` than the running shell restarts it — choosing another profile is a request
 * for a different shell, not for the old one to carry on.
 */
export function attach(
  key: string,
  cwd: string,
  profile: ShellProfile,
  handlers: PtyHandlers,
  cols = 80,
  rows = 24
): AttachResult {
  const existing = sessions.get(key);

  if (existing && !existing.disposed && existing.profileId === profile.id) {
    existing.handlers = handlers;
    if (cols > 0 && rows > 0) {
      try {
        existing.pty.resize(cols, rows);
      } catch {
        /* the shell may have exited between the check and here */
      }
    }
    return { restored: true, history: existing.buffer };
  }

  // A different profile, or a dead session: replace it.
  if (existing) dispose(key);

  const pty = spawn(profile.path, profile.args, {
    cwd,
    cols,
    rows,
    // What xterm.js advertises; anything less and colour output arrives as escape soup.
    name: 'xterm-256color',
    env: { ...process.env } as Record<string, string>
  });

  const session: Session = { pty, profileId: profile.id, buffer: '', handlers, disposed: false };
  sessions.set(key, session);

  pty.onData((chunk) => {
    // Buffered whether or not anyone is listening — that is what makes reattaching useful.
    remember(session, chunk);
    session.handlers?.onData(chunk);
  });
  pty.onExit(({ exitCode }) => {
    session.disposed = true;
    sessions.delete(key);
    session.handlers?.onExit(exitCode);
  });

  return { restored: false, history: '' };
}

/**
 * Stop forwarding output to a client, without touching the shell.
 *
 * What a closing socket does now. `only` guards against a stale socket detaching a session that a newer
 * client has since attached to.
 */
export function detach(key: string, only: PtyHandlers): void {
  const session = sessions.get(key);
  if (session && session.handlers === only) session.handlers = null;
}

export function write(key: string, data: string): void {
  const session = sessions.get(key);
  if (!session || session.disposed) return;
  try {
    session.pty.write(data);
  } catch {
    // The shell can exit between a keystroke arriving and being written; the exit handler already
    // told the client, so there is nothing useful to add here.
  }
}

export function resize(key: string, cols: number, rows: number): void {
  const session = sessions.get(key);
  if (!session || session.disposed) return;
  // A zero or negative dimension throws inside ConPTY rather than being ignored.
  if (cols < 1 || rows < 1) return;
  try {
    session.pty.resize(cols, rows);
  } catch {
    /* same race as write */
  }
}

/** Whether a project currently has a shell running, so the UI can mark it. */
export function isRunning(key: string): boolean {
  const session = sessions.get(key);
  return session !== undefined && !session.disposed;
}

/** Every project id with a live shell. */
export function running(): string[] {
  return [...sessions.entries()].filter(([, session]) => !session.disposed).map(([key]) => key);
}

/**
 * Kill a project's shell.
 *
 * Wrapped because ConPTY throws when the console behind the PTY has already gone — a shell that
 * exited on its own, or a child that took the console with it. That throw is not a failure worth
 * propagating: the process we wanted gone is gone.
 */
export function dispose(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  if (session.disposed) return;
  session.disposed = true;
  try {
    session.pty.kill();
  } catch {
    /* console already gone */
  }
}

export function disposeAll(): void {
  for (const key of [...sessions.keys()]) dispose(key);
}

export function count(): number {
  return sessions.size;
}
