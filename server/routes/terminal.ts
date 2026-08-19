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
import { randomUUID } from 'node:crypto';
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

      // One id per socket. A reconnecting client gets a fresh shell rather than reattaching: a PTY
      // holds no replayable history, so pretending to resume would show an empty screen mid-session.
      const id = randomUUID();

      // Requested profile, else the saved preference, else the best one detected. An unknown id falls
      // through to the default rather than erroring: a profile can vanish when a shell is uninstalled,
      // and a stale setting should not cost you a terminal.
      const requested = req.query.shell ?? state.read().settings?.terminalShell;
      const profile = shells.find(requested) ?? shells.defaultProfile();

      try {
        pty.start(id, project.path, profile, {
          onData: (chunk) => send({ type: 'output', data: chunk }),
          onExit: (code) => {
            send({ type: 'exit', code });
            try {
              socket.close();
            } catch {
              /* already closing */
            }
          }
        });
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
        scrollback: pty.SCROLLBACK_LIMIT
      });

      socket.on('message', (raw: Buffer | string) => {
        let message: TerminalClientMessage;
        try {
          message = JSON.parse(raw.toString()) as TerminalClientMessage;
        } catch {
          return;
        }
        if (message.type === 'input') pty.write(id, message.data);
        else if (message.type === 'resize') pty.resize(id, message.cols, message.rows);
      });

      // The important line in this file. A closed tab, a reload, or a dropped connection must take
      // the shell with it — otherwise it keeps running against the repo with nobody watching.
      socket.on('close', () => pty.dispose(id));
      socket.on('error', () => pty.dispose(id));
    }
  );
}
