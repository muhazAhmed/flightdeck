/**
 * Slash commands and skills for a project.
 *
 * A filesystem read, so it is cheap enough to call whenever a chat opens. Nothing here executes anything: the
 * command runs because the text reaches the CLI in the prompt, exactly as if it had been typed.
 */
import type { FastifyInstance } from 'fastify';
import type { SlashCommand } from '@shared/types';
import { commandsFor } from '../commands.js';
import * as state from '../state.js';
import { notFound } from '../errors.js';

export async function commandRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>('/api/commands', async (req, reply): Promise<{ commands: SlashCommand[] } | never> => {
    const project = req.query.projectId ? state.findProject(req.query.projectId) : undefined;
    if (!project) return notFound(reply, 'No such project.') as never;
    return { commands: commandsFor(project.path) };
  });
}
