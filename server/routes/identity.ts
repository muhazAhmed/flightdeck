/**
 * Git identity per project, plus a list of saved identities to switch between.
 *
 * WHY THIS EXISTS: one machine, several clients. Personal work commits as one name, company
 * work as another, and the manual fix is remembering to run
 * `git config user.name` / `user.email` in the right repository before the first commit —
 * which people remember precisely once, after the wrong name is already in the history.
 *
 * Flight Deck already knows which project you are committing to, so it can show the identity
 * next to the commit box and switch it in one click. Writes are always `--local`: a global
 * default stays untouched, and the change lands in that repository's `.git/config` exactly
 * as if it had been typed by hand.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { GitIdentity, SavedIdentity } from '@shared/types';
import { messageOf, runGit } from '../git-exec.js';
import * as state from '../state.js';
import { badRequest, notFound, serverError } from '../errors.js';

/** A trivially wrong email is worth catching before it reaches a commit. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readConfig(cwd: string, key: string, scope: '--local' | '--global'): Promise<string | null> {
  // `--get` exits 1 when the key is simply absent, which is not an error here.
  const result = await runGit(cwd, ['config', scope, '--get', key]);
  const value = result.stdout.trim();
  return result.ok && value ? value : null;
}

/**
 * Which identity a commit in this repository would actually use, and where it comes from.
 * `local` means this repo overrides; `global` is the machine default; `none` means git would
 * refuse or invent something.
 */
async function currentIdentity(cwd: string): Promise<GitIdentity> {
  const [localName, localEmail] = await Promise.all([
    readConfig(cwd, 'user.name', '--local'),
    readConfig(cwd, 'user.email', '--local')
  ]);
  if (localName && localEmail) return { name: localName, email: localEmail, scope: 'local' };

  const [globalName, globalEmail] = await Promise.all([
    readConfig(cwd, 'user.name', '--global'),
    readConfig(cwd, 'user.email', '--global')
  ]);
  if (globalName && globalEmail) return { name: globalName, email: globalEmail, scope: 'global' };

  return { name: localName ?? globalName ?? null, email: localEmail ?? globalEmail ?? null, scope: 'none' };
}

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  /** The identity in force for a project, plus the saved list to switch between. */
  app.get<{ Querystring: { projectId?: string } }>('/api/git/identity', async (req, reply) => {
    const project = req.query.projectId ? state.findProject(req.query.projectId) : undefined;
    if (!project) return notFound(reply, 'No such project.');
    return { current: await currentIdentity(project.path), saved: state.read().identities };
  });

  /**
   * Set this repository's identity. Local scope only — deliberately. Writing a global
   * identity from a per-project panel would change the default for every repo on the
   * machine, which is the opposite of what a switcher is for.
   */
  app.post<{ Body: { projectId?: string; name?: string; email?: string; save?: boolean; label?: string } }>(
    '/api/git/identity',
    async (req, reply) => {
      const { projectId, name, email, save, label } = req.body ?? {};
      const project = projectId ? state.findProject(projectId) : undefined;
      if (!project) return notFound(reply, 'No such project.');

      const trimmedName = name?.trim();
      const trimmedEmail = email?.trim();
      if (!trimmedName) return badRequest(reply, 'A name is required.');
      if (!trimmedEmail) return badRequest(reply, 'An email is required.');
      if (!looksLikeEmail(trimmedEmail)) return badRequest(reply, `That does not look like an email: ${trimmedEmail}`);

      const setName = await runGit(project.path, ['config', '--local', 'user.name', trimmedName]);
      if (!setName.ok) return serverError(reply, 'Could not set user.name.', messageOf(setName));
      const setEmail = await runGit(project.path, ['config', '--local', 'user.email', trimmedEmail]);
      if (!setEmail.ok) return serverError(reply, 'Could not set user.email.', messageOf(setEmail));

      if (save) {
        state.update((s) => {
          const already = s.identities.some((i) => i.name === trimmedName && i.email === trimmedEmail);
          if (!already) {
            s.identities.push({
              id: randomUUID(),
              label: label?.trim() || trimmedName,
              name: trimmedName,
              email: trimmedEmail
            });
          }
        });
      }

      return { current: await currentIdentity(project.path), saved: state.read().identities };
    }
  );

  /** Forget a saved identity. Does not touch any repository's config — removing a shortcut
   *  must never silently change what a repo would commit as. */
  app.delete<{ Params: { id: string } }>('/api/identities/:id', async (req, reply) => {
    const removed = state.update((s) => {
      const before = s.identities.length;
      s.identities = s.identities.filter((i: SavedIdentity) => i.id !== req.params.id);
      return s.identities.length < before;
    });
    return removed ? { ok: true, saved: state.read().identities } : notFound(reply, 'No such saved identity.');
  });
}
