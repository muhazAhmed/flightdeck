/**
 * A project's runnable scripts.
 *
 * A filesystem read, and read on every request rather than cached: someone adding a script to package.json expects
 * the button to know about it without restarting the server.
 */
import type { FastifyInstance } from 'fastify';
import type { ProjectScripts } from '@shared/types';
import { scriptsFor } from '../scripts.js';
import * as state from '../state.js';
import { notFound } from '../errors.js';

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>(
    '/api/scripts',
    async (req, reply): Promise<ProjectScripts | never> => {
      const project = req.query.projectId ? state.findProject(req.query.projectId) : undefined;
      if (!project) return notFound(reply, 'No such project.') as never;
      return scriptsFor(project.path);
    }
  );
}
