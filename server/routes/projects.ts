import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { BrowseResult, DirEntry, PermissionMode, Project } from '@shared/types';
import { defaultBrowseDir } from '../platform.js';
import * as state from '../state.js';
import { badRequest, notFound } from '../errors.js';

const PERMISSION_MODES: PermissionMode[] = ['acceptEdits', 'plan', 'bypassPermissions'];

function isRepo(dir: string): boolean {
  // A linked worktree has `.git` as a file, not a directory, so test existence only.
  return existsSync(join(dir, '.git'));
}

/** Stable, readable id derived from the folder name, de-duplicated against existing
 *  projects so two `web` folders from different parents can coexist. */
function makeId(path: string, taken: Set<string>): string {
  const base = basename(path).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const seed = base || 'project';
  if (!taken.has(seed)) return seed;
  let n = 2;
  while (taken.has(`${seed}-${n}`)) n++;
  return `${seed}-${n}`;
}

function listDir(dir: string): BrowseResult {
  const entries: DirEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue; // permission denied, or a link to nowhere
    }
    entries.push({ name, path, isDir: true, isRepo: isRepo(path) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(dir);
  return { dir, parent: parent === dir ? null : parent, entries };
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => state.read().projects);

  app.get<{ Querystring: { dir?: string } }>('/api/fs/browse', async (req, reply) => {
    const requested = req.query.dir?.trim();
    const dir = requested && requested.length > 0 ? resolve(requested) : (state.read().lastBrowsedDir ?? defaultBrowseDir());
    if (!existsSync(dir)) return badRequest(reply, `No such directory: ${dir}`, 'ENOENT');
    try {
      const result = listDir(dir);
      state.update((s) => {
        s.lastBrowsedDir = dir;
      });
      return result;
    } catch (err) {
      return badRequest(reply, `Cannot read ${dir}`, 'EACCES', err instanceof Error ? err.message : undefined);
    }
  });

  app.post<{ Body: { path?: string; name?: string } }>('/api/projects', async (req, reply) => {
    const raw = req.body?.path?.trim();
    if (!raw) return badRequest(reply, 'A folder path is required.');
    if (!isAbsolute(raw)) return badRequest(reply, 'The path must be absolute.');

    const path = resolve(raw);
    if (!existsSync(path)) return badRequest(reply, `No such folder: ${path}`, 'ENOENT');
    if (!statSync(path).isDirectory()) return badRequest(reply, `Not a folder: ${path}`);
    if (!isRepo(path)) return badRequest(reply, `Not a git repository: ${path}`, 'NOT_A_REPO');

    const existing = state.read().projects.find((p) => p.path === path);
    if (existing) return badRequest(reply, `${existing.name} is already on the list.`, 'DUPLICATE');

    return state.update((s) => {
      const project: Project = {
        id: makeId(path, new Set(s.projects.map((p) => p.id))),
        name: req.body?.name?.trim() || basename(path),
        path,
        addedAt: new Date().toISOString(),
        // Existing projects keep whatever they have; this only seeds new ones.
        defaultPermissionMode: s.settings?.defaultPermissionMode ?? 'acceptEdits'
      };
      s.projects.push(project);
      return project;
    });
  });

  app.patch<{
    Params: { id: string };
    Body: { name?: string; defaultPermissionMode?: PermissionMode; verifyCommand?: string };
  }>('/api/projects/:id', async (req, reply) => {
    const { name, defaultPermissionMode, verifyCommand } = req.body ?? {};
    if (defaultPermissionMode && !PERMISSION_MODES.includes(defaultPermissionMode)) {
      return badRequest(reply, `Unknown permission mode: ${defaultPermissionMode}`);
    }
    const updated = state.update((s) => {
      const project = s.projects.find((p) => p.id === req.params.id);
      if (!project) return null;
      if (name?.trim()) project.name = name.trim();
      if (defaultPermissionMode) project.defaultPermissionMode = defaultPermissionMode;
      if (verifyCommand !== undefined) project.verifyCommand = verifyCommand.trim() || undefined;
      return project;
    });
    return updated ?? notFound(reply, 'No such project.');
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const removed = state.update((s) => {
      const index = s.projects.findIndex((p) => p.id === req.params.id);
      if (index < 0) return false;
      s.projects.splice(index, 1);
      // Chats belong to a project; leaving them orphaned would resurrect them if the
      // same folder were re-added later with a different id.
      s.chats = s.chats.filter((c) => c.projectId !== req.params.id);
      return true;
    });
    return removed ? { ok: true } : notFound(reply, 'No such project.');
  });
}
