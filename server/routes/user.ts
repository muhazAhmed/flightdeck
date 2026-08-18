import type { FastifyInstance } from 'fastify';
import type { UserInfo } from '@shared/types';
import { runGit } from '../git-exec.js';
import { homedir } from 'node:os';

/**
 * Who you are, machine-wide — read from global git config so the sidebar footer can show it
 * without a project being selected.
 *
 * Deliberately global: the per-repository identity lives in the Changes panel next to the
 * commit box, where it affects the thing you are about to do. This is just "who is using the
 * app", and git is the only place that already knows.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/user', async (): Promise<UserInfo> => {
    // Run from the home directory: any path works for reading global config, and this one is
    // guaranteed to exist even before a project is added.
    const cwd = homedir();
    const [name, email] = await Promise.all([
      runGit(cwd, ['config', '--global', '--get', 'user.name']),
      runGit(cwd, ['config', '--global', '--get', 'user.email'])
    ]);
    return {
      name: name.ok ? name.stdout.trim() || null : null,
      email: email.ok ? email.stdout.trim() || null : null
    };
  });
}
