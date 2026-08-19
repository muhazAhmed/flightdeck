/**
 * What Flight Deck has written outside your repositories.
 *
 * The Privacy section is only honest if it can name the actual paths and sizes rather than describing
 * them — "attachments are stored locally" is a claim, `~/.flightdeck/attachments · 14 files · 8.2 MB`
 * with a delete button is a fact you can act on.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { StorageUsage } from '@shared/types';
import { attachmentsDir, statePath } from '../platform.js';
import { serverError } from '../errors.js';

/**
 * Count and total size of everything under the attachments directory.
 *
 * Attachments are stored in day-named subdirectories, so this walks a few levels deep. A directory
 * that cannot be read is skipped rather than failing the whole report — a partial number is more
 * useful here than an error.
 *
 * Exported for tests: the purge below cannot be exercised against a real home directory without
 * deleting the author's own files, so the measuring half is tested against a temporary tree instead.
 */
export function measureAttachments(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;

  const visit = (path: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) visit(child, depth + 1);
        continue;
      }
      try {
        bytes += statSync(child).size;
        count += 1;
      } catch {
        /* deleted between the listing and the stat */
      }
    }
  };

  visit(dir, 0);
  return { count, bytes };
}

export async function storageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/storage', async (): Promise<StorageUsage> => {
    const dir = attachmentsDir();
    const { count, bytes } = measureAttachments(dir);
    return { stateFile: statePath(), attachmentsDir: dir, attachmentCount: count, attachmentBytes: bytes };
  });

  /**
   * Delete every attachment.
   *
   * Scoped to the attachments directory and nothing else — it never touches `state.json`, and it
   * cannot reach a repository, because the path is built here from `stateDir()` rather than accepted
   * from the client.
   *
   * Prompts that referenced these files keep the paths in their text; the transcript is the CLI's and
   * is not rewritten. That is said plainly in the UI before the button is pressed.
   */
  app.delete('/api/storage/attachments', async (_req, reply) => {
    const dir = attachmentsDir();
    try {
      const before = measureAttachments(dir);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      return { deleted: before.count, freedBytes: before.bytes };
    } catch (err) {
      return serverError(
        reply,
        'Could not delete the attachments.',
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
