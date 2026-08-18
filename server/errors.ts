import type { FastifyReply } from 'fastify';
import type { ApiError } from '@shared/types';

/**
 * One error shape for every failure, so the client has a single path for handling them
 * and always has something real to show. `detail` carries raw stderr from git or claude
 * and is never summarised or rewritten — see CLAUDE.md rule 4.
 */
function fail(reply: FastifyReply, status: number, message: string, code?: string, detail?: string): ApiError {
  reply.status(status);
  return { error: { message, ...(code ? { code } : {}), ...(detail ? { detail } : {}) } };
}

export function badRequest(reply: FastifyReply, message: string, code?: string, detail?: string): ApiError {
  return fail(reply, 400, message, code, detail);
}

export function notFound(reply: FastifyReply, message: string, code?: string): ApiError {
  return fail(reply, 404, message, code);
}

export function serverError(reply: FastifyReply, message: string, detail?: string, code?: string): ApiError {
  return fail(reply, 500, message, code, detail);
}
