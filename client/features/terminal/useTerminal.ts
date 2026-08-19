import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalServerMessage } from '@shared/types';

export interface TerminalStatus {
  state: 'connecting' | 'ready' | 'exited' | 'error';
  shell: string | null;
  /** Which profile actually started — the server may fall back if the requested one is gone. */
  shellId: string | null;
  message: string | null;
}

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

  const [status, setStatus] = useState<TerminalStatus>({
    state: 'connecting',
    shell: null,
    shellId: null,
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
          setStatus({ state: 'ready', shell: message.shell, shellId: message.shellId, message: null });
          requestAnimationFrame(syncSize);
          break;
        case 'output':
          terminal.write(message.data);
          settled.current?.();
          break;
        case 'exit':
          setStatus({ state: 'exited', shell: null, shellId: null, message: `Shell exited (${message.code})` });
          terminal.writeln(`\r\n[2m— shell exited with code ${message.code} —[0m`);
          break;
        case 'error':
          setStatus({ state: 'error', shell: null, shellId: null, message: message.detail ?? message.message });
          terminal.writeln(`\r\n[31m${message.message}[0m`);
          break;
      }
    };

    socket.onerror = () =>
      setStatus({
        state: 'error',
        shell: null,
        shellId: null,
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

  const focus = useCallback(() => terminalRef.current?.focus(), []);
  const clear = useCallback(() => terminalRef.current?.clear(), []);

  return { containerRef, status, focus, clear, syncSize };
}
