/**
 * What this machine has, for the features that need something Flight Deck does not ship.
 *
 * Asked at the point of use rather than at install time: nobody reads a dependency list before they need it,
 * and a check at launch tells you about a tool you may never use. The page that needs `gh` is the page that
 * asks — see `server/tools.ts` for why nothing here installs anything.
 */
import type { FastifyInstance } from 'fastify';
import type { ToolStatus } from '@shared/types';
import * as tools from '../tools.js';

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Sign in to GitHub by handing `gh` a token.
   *
   * The token goes straight to `gh auth login --with-token` on stdin and gh stores it in the system credential
   * store. Flight Deck never writes it anywhere, never logs it, and never sends it back — the response is the
   * re-probed tool status and nothing else.
   *
   * A failure returns gh's own words with a 400, so "bad credentials" reads as bad credentials rather than as
   * "something went wrong".
   */
  app.post<{ Body: { token?: string } }>('/api/tools/gh/login', async (req, reply) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const result = await tools.ghLoginWithToken(token);
    if (!result.ok) {
      return reply.code(400).send({
        message: 'GitHub refused that token.',
        detail: result.detail,
        code: 'GH_LOGIN_FAILED'
      });
    }
    return tools.read({ refresh: true });
  });

  /**
   * `?refresh=1` re-probes instead of answering from the cache.
   *
   * The cache exists because `gh auth status` is a network round trip. The escape hatch exists because the
   * user pressing "try again" has just installed something, and a cache with no way past it would keep
   * reporting "not found" until the server restarted — which reads as a broken feature rather than a stale
   * answer.
   */
  app.get<{ Querystring: { refresh?: string } }>(
    '/api/tools',
    async (req): Promise<{ tools: ToolStatus[]; checkedAt: string }> =>
      tools.read({ refresh: req.query.refresh === '1' })
  );
}
