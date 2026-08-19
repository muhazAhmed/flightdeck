/**
 * The terminal's transport: one WebSocket per open shell.
 *
 * A socket rather than SSE because a terminal is bidirectional — keystrokes go up, bytes come down,
 * and resize events go up. SSE would need a second channel for input.
 *
 * Messages are JSON in both directions, which costs a little throughput and buys a resize event and
 * an exit code without inventing a framing scheme. Terminal output is human-paced; the overhead does
 * not matter at this scale.
 */
import type { FastifyInstance } from 'fastify';
import type { TerminalClientMessage, TerminalServerMessage } from '@shared/types';
import * as pty from '../pty.js';
import * as shells from '../shells.js';
import * as state from '../state.js';

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  /**
   * What this machine can actually open. Detection is cached server-side, so the picker costs one
   * request per app load and never blocks the terminal from starting.
   */
  app.get('/api/terminal/shells', async () => ({
    profiles: shells.detect(),
    defaultId: shells.defaultProfile().id
  }));

  app.get<{ Querystring: { projectId?: string; shell?: string } }>(
    '/ws/terminal',
    { websocket: true },
    (socket, req) => {
      const send = (message: TerminalServerMessage) => {
        // The socket can close between a PTY write and this call; a dead socket throws on send.
        try {
          socket.send(JSON.stringify(message));
        } catch {
          /* client already gone */
        }
      };

      const project = req.query.projectId ? state.findProject(req.query.projectId) : undefined;
      if (!project) {
        send({ type: 'error', message: 'No such project — the terminal needs a project to start in.' });
        socket.close();
        return;
      }

      /*
       * Keyed by project, not by socket.
       *
       * This is what stops a project switch from killing a running dev server: the terminal remounts, this socket
       * closes, and the shell carries on. Reattaching replays what it printed in the meantime, so coming back to a
       * project shows its server still logging rather than a blank prompt.
       */
      const key = project.id;

      // Requested profile, else the saved preference, else the best one detected. An unknown id falls
      // through to the default rather than erroring: a profile can vanish when a shell is uninstalled,
      // and a stale setting should not cost you a terminal.
      const requested = req.query.shell ?? state.read().settings?.terminalShell;
      const profile = shells.find(requested) ?? shells.defaultProfile();

      const handlers: pty.PtyHandlers = {
        onData: (chunk) => send({ type: 'output', data: chunk }),
        onExit: (code) => {
          send({ type: 'exit', code });
          try {
            socket.close();
          } catch {
            /* already closing */
          }
        }
      };

      let attached;
      try {
        attached = pty.attach(key, project.path, profile, handlers);
      } catch (err) {
        send({
          type: 'error',
          message: 'Could not start a shell.',
          detail: err instanceof Error ? err.message : String(err)
        });
        socket.close();
        return;
      }

      send({
        type: 'ready',
        shell: profile.label,
        shellId: profile.id,
        cwd: project.path,
        scrollback: pty.SCROLLBACK_LIMIT,
        restored: attached.restored
      });

      // Replayed as ordinary output, so the client needs no special path for it: xterm renders escape codes the
      // same whether they arrive live or from a buffer.
      if (attached.history.length > 0) send({ type: 'output', data: attached.history });

      socket.on('message', (raw: Buffer | string) => {
        let message: TerminalClientMessage;
        try {
          message = JSON.parse(raw.toString()) as TerminalClientMessage;
        } catch {
          return;
        }
        if (message.type === 'input') pty.write(key, message.data);
        else if (message.type === 'resize') pty.resize(key, message.cols, message.rows);
        // An explicit stop, since a closing socket no longer kills the shell. This is the only path that does.
        else if (message.type === 'stop') pty.dispose(key);
      });

      /*
       * A closing socket detaches; it does not kill.
       *
       * The opposite of what this used to do, and the reason is in pty.ts: a dev server must survive the terminal
       * being remounted by a project switch or a reload. `detach` is given these handlers so a stale socket cannot
       * silence a session a newer client has since claimed. Shells still die with the server, and can be stopped
       * explicitly from the UI.
       */
      socket.on('close', () => pty.detach(key, handlers));
      socket.on('error', () => pty.detach(key, handlers));
    }
  );
}
