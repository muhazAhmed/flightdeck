import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalServerMessage } from '@shared/types';
import { useWorkspace } from '@/store/workspace';
import { detectDeviceCode, type DeviceCode } from './deviceCode';

export interface TerminalStatus {
  state: 'connecting' | 'ready' | 'exited' | 'error';
  shell: string | null;
  /** Which profile actually started — the server may fall back if the requested one is gone. */
  shellId: string | null;
  /** True when this attached to a shell that was already running, rather than starting one. */
  restored: boolean;
  message: string | null;
}

/**
 * What a shell reads as "the user pressed Enter".
 *
 * Built from its code point on purpose: written as a literal in a template string it is an invisible control
 * character, and the first tool to normalise line endings turns it into CRLF or removes it — after which a queued
 * command is typed into the prompt and never runs.
 */
const ENTER = String.fromCharCode(13);

/**
 * How much recent output is kept for pattern-matching.
 *
 * A tail, not the session: the point is to notice a prompt that is on screen now, and a device code found
 * halfway up a scrollback is worse than none. Four kilobytes covers the few lines such a prompt occupies even
 * when the PTY delivers them a byte at a time.
 */
const TAIL_BYTES = 4096;

/** Read a colour token off the document so the terminal repaints with the app's theme. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * xterm.js wired to a WebSocket, living for as long as the drawer is open.
 *
 * WHY A HOOK AND NOT A COMPONENT: an xterm instance is imperative and expensive — it owns a canvas, a
 * WebGL context and a resize observer. Creating it inside a component body would make every parent
 * re-render a candidate for tearing it down. Here it is created once per mount and disposed exactly
 * once, and React never re-renders it.
 *
 * DISPOSAL IS THE WHOLE POINT of the cleanup below. A leaked WebGL context is a real leak the browser
 * will eventually punish (there is a hard limit on live contexts), and a leaked socket leaves a shell
 * running on the server.
 */
export interface TerminalAppearance {
  fontSize: number;
  cursorBlink: boolean;
}

export function useTerminal(
  projectId: string | null,
  shellId: string | null,
  appearance: TerminalAppearance,
  /**
   * Called when the shell has gone quiet after producing output.
   *
   * A `git merge`, `checkout`, `commit` or `pull` typed in here changes exactly the state the Changes panel
   * shows, and nothing else would tell it. Parsing the input to spot git commands is not worth attempting —
   * arrow keys, history and aliases all defeat it — so any output settling counts, and the listener debounces.
   */
  onSettled?: () => void
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const pendingCommand = useWorkspace((s) => s.pendingCommand);
  const clearPendingCommand = useWorkspace((s) => s.clearPendingCommand);

  /**
   * A device-code login waiting to be completed, when the shell has printed one.
   *
   * Lifted out of the stream because a terminal makes copying it hard: `Ctrl+C` is SIGINT, so the obvious
   * attempt kills the flow. See `deviceCode.ts`.
   */
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  // Mirrored so the socket handler can compare without being re-created — re-creating it would kill the shell.
  const deviceCodeRef = useRef<DeviceCode | null>(null);
  const tailRef = useRef('');

  const [status, setStatus] = useState<TerminalStatus>({
    state: 'connecting',
    shell: null,
    shellId: null,
    restored: false,
    message: null
  });

  /** Send the current size so the shell wraps where the user sees the edge. */
  const syncSize = useCallback(() => {
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!fit || !terminal) return;
    try {
      fit.fit();
    } catch {
      // fit throws while the container is display:none or zero-height, which happens on the frame
      // the drawer opens.
      return;
    }
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  }, []);

  // Read at creation only. The effect below deliberately does not depend on appearance — see the
  // appearance effect further down for why.
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;

  // Same reason as `appearance`: this must not re-create the terminal, which would kill the shell.
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !projectId) return;
    const initial = appearanceRef.current;

    const terminal = new Terminal({
      // 5000 lines: enough to scroll back through a build, not enough to hold a gigabyte of log.
      scrollback: 5000,
      fontFamily: token('--font-mono') || 'monospace',
      fontSize: initial.fontSize,
      lineHeight: 1.35,
      cursorBlink: initial.cursorBlink,
      // The shell's own colours arrive as escape codes; only the surrounding chrome is ours.
      theme: {
        background: token('--bg-base') || '#101319',
        foreground: token('--text-primary') || '#e8ebf0',
        cursor: token('--accent-bright') || '#22d3ee',
        selectionBackground: token('--accent-subtle') || 'rgba(34,211,238,0.24)'
      },
      allowProposedApi: true
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);

    // WebGL is the difference between a smooth scroll and a janky one on a busy build log. It fails
    // on machines without a usable GL context, where the DOM renderer is a correct fallback.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      /* DOM renderer it is */
    }

    terminalRef.current = terminal;
    fitRef.current = fit;

    // The shell id is part of the connection, not a message: a PTY's program is fixed at spawn, so
    // switching profiles means a new socket — which is exactly what the effect below does when
    // `shellId` changes.
    const query = new URLSearchParams({ projectId });
    if (shellId) query.set('shell', shellId);
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal?${query.toString()}`
    );
    socketRef.current = socket;

    socket.onopen = () => requestAnimationFrame(syncSize);

    socket.onmessage = (event) => {
      let message: TerminalServerMessage;
      try {
        message = JSON.parse(String(event.data)) as TerminalServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case 'ready':
          setStatus({
            state: 'ready',
            shell: message.shell,
            shellId: message.shellId,
            restored: message.restored,
            message: null
          });
          requestAnimationFrame(syncSize);
          break;
        case 'output': {
          terminal.write(message.data);
          settled.current?.();

          /*
           * Scanning happens here, but state is only set on a transition.
           *
           * The rule is that nothing may `setState` per chunk — a busy build log would re-render the app
           * thousands of times. So the tail is kept in a ref, the scan is behind a cheap prefilter, and React
           * only hears about it when a *different* code appears, which happens once per login.
           */
          /*
           * Replayed history is rendered but never read.
           *
           * A shell that was left in a device-code login an hour ago replays that text on reattach, and a
           * banner raised from it would offer to press Enter into whatever is running now. Found by the first
           * review this feature ever ran.
           */
          if (message.replay) break;

          tailRef.current = (tailRef.current + message.data).slice(-TAIL_BYTES);
          /*
           * The prefilter also has to let a refinement through.
           *
           * `Press Enter to open <url>` does not contain the word "code", so filtering on the chunk alone
           * meant the URL that arrives in the next chunk never reached the matcher — the fix for the missing
           * link was dead code until the review pointed at it. While a code is live, every chunk is scanned.
           */
          if (/code/i.test(message.data) || deviceCodeRef.current !== null) {
            const found = detectDeviceCode(tailRef.current);
            const known = deviceCodeRef.current;
            /*
             * A new code, or the same one with the URL that arrived after it.
             *
             * The refinement matters: the code and the "Press Enter to open <url>" line arrive in separate
             * chunks, so the first match has no URL — and comparing only the code meant the first answer won
             * and the link never appeared. Seen exactly that way in use.
             */
            const better = found !== null && (found.code !== known?.code || (found.url !== null && !known?.url));
            if (found && better) {
              deviceCodeRef.current = found;
              setDeviceCode(found);
            }
          }
          break;
        }
        case 'exit':
          setStatus({
            state: 'exited',
            shell: null,
            shellId: null,
            restored: false,
            message: `Shell exited (${message.code})`
          });
          terminal.writeln(`\r\n[2m— shell exited with code ${message.code} —[0m`);
          break;
        case 'error':
          setStatus({
            state: 'error',
            shell: null,
            shellId: null,
            restored: false,
            message: message.detail ?? message.message
          });
          terminal.writeln(`\r\n[31m${message.message}[0m`);
          break;
      }
    };

    socket.onerror = () =>
      setStatus({
        state: 'error',
        shell: null,
        shellId: null,
        restored: false,
        message: 'Lost the connection to the Flight Deck server.'
      });

    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
    });

    // The drawer is resizable, so the size changes for reasons unrelated to the window.
    const observer = new ResizeObserver(() => syncSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      input.dispose();
      // Close the socket first: the server disposes the shell on close, so this is what stops a
      // process from outliving the drawer.
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      socketRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
    // Changing the shell tears the whole terminal down and builds a new one. Reusing the xterm
    // instance would leave the previous shell's output above a new prompt, which reads as one broken
    // session rather than two.
  }, [projectId, shellId, syncSize]);

  /**
   * Appearance changes mutate the live instance instead of re-running the effect above.
   *
   * This is the whole reason `appearance` is read through a ref there: putting it in the deps would
   * dispose the terminal and its socket on every keystroke of the font-size stepper, and the server
   * kills the shell when the socket closes. Nudging the size would end a running build.
   */
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = appearance.fontSize;
    terminal.options.cursorBlink = appearance.cursorBlink;
    // Cell metrics changed, so the shell needs to be told the new column count.
    syncSize();
  }, [appearance.fontSize, appearance.cursorBlink, syncSize]);

  /**
   * Type a queued command once the shell is ready.
   *
   * Sent as input rather than run server-side, deliberately: the point of this button is that the output lands in
   * your terminal and `Ctrl+C` stops it, exactly as if you had typed it. That is the opposite trade-off from the
   * build trigger, which must not go through a shell — there the command is fixed and its result is a git state; here
   * the command is a long-running process whose log you want to watch.
   *
   * Cleared as soon as it is written, so a re-render cannot type it twice.
   */
  useEffect(() => {
    if (!pendingCommand || status.state !== 'ready') return;
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: 'input', data: pendingCommand + ENTER }));
    clearPendingCommand();
    terminalRef.current?.focus();
  }, [pendingCommand, status.state, clearPendingCommand]);

  /**
   * Kill this project's shell.
   *
   * Needed because a closing socket now only detaches: without this there would be no way to stop a wedged shell
   * short of restarting the server. The socket is left alone — the server reports the exit through it.
   */
  const stop = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
  }, []);

  /**
   * Type something into the shell on the user's behalf.
   *
   * Used by the device-code banner to press Enter, which is what a `gh auth login` prompt is waiting for. Not a
   * general-purpose door: everything else goes through the queue in the store, which exists so a command can be
   * requested before the socket is open.
   */
  const send = useCallback((data: string) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
  }, []);

  const dismissDeviceCode = useCallback(() => {
    deviceCodeRef.current = null;
    setDeviceCode(null);
  }, []);

  const focus = useCallback(() => terminalRef.current?.focus(), []);
  const clear = useCallback(() => {
    terminalRef.current?.clear();
    // Clearing the screen must clear what was read off it, or a banner outlives the prompt it belongs to.
    tailRef.current = '';
    deviceCodeRef.current = null;
    setDeviceCode(null);
  }, []);

  return { containerRef, status, focus, clear, stop, send, syncSize, deviceCode, dismissDeviceCode, ENTER };
}
