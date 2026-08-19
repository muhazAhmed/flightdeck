/**
 * Attaching files and images to a prompt.
 *
 * WHY A PATH AND NOT AN UPLOAD: the CLI's `--file` flag takes cloud file ids, not local paths, and
 * there is no local attachment channel. What the agent *does* have is a `Read` tool that reads text
 * files and images from disk. So an attachment here means "put a file somewhere on disk and give
 * the agent its path" — which works identically for a screenshot pasted from the clipboard and for
 * a source file dragged in from Explorer.
 *
 * A browser cannot tell us where a dropped file came from (it hands over bytes and a name, never a
 * path), so the bytes are written to `~/.flightdeck/attachments/` and that path goes into the
 * prompt. For a file that already lives in the project, typing its repo-relative path is better and
 * costs nothing — the UI says so.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Attachment } from '@shared/types';
import { attachmentsDir } from '../platform.js';
import { badRequest, serverError } from '../errors.js';

/** Matches the server's 8MB body cap with room for base64's ~33% overhead. */
export const MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

/**
 * Keep the original name recognisable while making it safe to write. The uuid prefix guarantees
 * uniqueness, so the name only has to be legible, not unique — two screenshots called
 * `image.png` must not collide.
 */
export function safeName(name: string): string {
  const trimmed = name.trim().replace(/[\\/]/g, '-');
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || 'attachment';
}

function todayDir(): string {
  // Grouped by day so the folder stays browsable after a few months of use.
  const day = new Date().toISOString().slice(0, 10);
  const dir = join(attachmentsDir(), day);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { name?: string; dataBase64?: string } }>('/api/attachments', async (req, reply) => {
    const name = req.body?.name;
    const dataBase64 = req.body?.dataBase64;
    if (!name || typeof name !== 'string') return badRequest(reply, 'A file name is required.');
    if (!dataBase64 || typeof dataBase64 !== 'string') return badRequest(reply, 'File contents are required.');

    let bytes: Buffer;
    try {
      bytes = Buffer.from(dataBase64, 'base64');
    } catch {
      return badRequest(reply, 'The file contents could not be decoded.');
    }
    if (bytes.byteLength === 0) return badRequest(reply, 'That file is empty.');
    if (bytes.byteLength > MAX_BYTES) {
      return badRequest(
        reply,
        `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_BYTES / 1024 / 1024} MB.`,
        'TOO_LARGE'
      );
    }

    const clean = safeName(name);
    const path = join(todayDir(), `${randomUUID().slice(0, 8)}-${clean}`);
    try {
      writeFileSync(path, bytes);
    } catch (err) {
      return serverError(reply, 'Could not save the attachment.', err instanceof Error ? err.message : String(err));
    }

    const attachment: Attachment = {
      name: clean,
      path,
      sizeBytes: bytes.byteLength,
      kind: IMAGE_EXTENSIONS.has(extname(clean).toLowerCase()) ? 'image' : 'file'
    };
    return attachment;
  });
}
