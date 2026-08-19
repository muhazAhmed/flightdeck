/**
 * Update checks for this install.
 *
 * Read is local and cheap; the fetch is the one outbound request Flight Deck makes on its own behalf, and it
 * only happens when asked — the client asks once per launch, and only while `settings.checkForUpdates` is on.
 */
import type { FastifyInstance } from 'fastify';
import type { UpdateStatus } from '@shared/types';
import { applyUpdate, fetchAndRead, readUpdateStatus } from '../update.js';
import * as state from '../state.js';
import { badRequest } from '../errors.js';

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  /** Local only: where the install stands with whatever it already knows about the remote. */
  app.get('/api/update', async (): Promise<UpdateStatus> => readUpdateStatus());

  /**
   * Contact the remote, then report.
   *
   * Refused when the user has turned update checks off, so the setting means what it says even if something
   * calls this route anyway.
   */
  app.post('/api/update/check', async (_req, reply): Promise<UpdateStatus | never> => {
    if (state.read().settings?.checkForUpdates === false) {
      return badRequest(reply, 'Update checks are turned off in settings.', 'DISABLED') as never;
    }
    return fetchAndRead();
  });

  /**
   * Fast-forward to the remote.
   *
   * Guarded in `applyUpdate`: no dirty tree, no divergence, no merge, no reset. A refusal is a 400 with the
   * reason and the current status, so the UI can explain itself without a second request.
   */
  app.post('/api/update/apply', async (_req, reply) => {
    const result = await applyUpdate();
    if (!result.ok) {
      reply.status(400);
      return { error: { message: result.message, detail: result.detail }, status: result.status };
    }
    return { message: result.message, detail: result.detail, status: result.status };
  });
}
