/**
 * Reviewing a branch before it becomes a pull request.
 *
 * One ordinary agent run, streamed the way a chat is — same spawn, same events, same accounting. The only
 * differences are that the chat is ephemeral (a review is not a conversation, and twenty of them in the
 * sidebar would bury the chats that are), that it runs in `plan` mode so it cannot edit the tree it is
 * judging, and that its final message is parsed into findings.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ReviewEvent, ReviewResult } from '@shared/types';
import * as agent from '../agent.js';
import * as github from '../github.js';
import * as review from '../review.js';
import * as state from '../state.js';
import * as usage from '../usage.js';
import { badRequest, notFound } from '../errors.js';

/** Same three lines as the chat stream, kept local for the same reason: the framing stays inspectable. */
function openStream(reply: FastifyReply): (event: ReviewEvent) => void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  return (event: ReviewEvent) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  /**
   * What there is to review, and the last review if one has been run.
   *
   * Read before the button is offered, so a clean tree says "nothing differs from origin/dev" rather than
   * spending a run to discover it.
   */
  app.get<{ Params: { id: string } }>('/api/projects/:id/review', async (req, reply) => {
    const project = state.findProject(req.params.id);
    if (!project) return notFound(reply, 'No such project.');
    const context = await review.resolveContext(project, project.fastForwardRef ?? null);
    return { context, last: review.lastFor(project.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id/review', async (req, reply) => {
    const project = state.findProject(req.params.id);
    if (!project) return notFound(reply, 'No such project.');
    review.forget(project.id);
    return { ok: true };
  });

  /**
   * Open pull requests across every project.
   *
   * The cross-repository question — "which of these have something waiting?" — which is the reason this page
   * exists rather than a browser tab. One project failing costs that project its rows and nothing else.
   */
  app.get('/api/pulls', async () => ({ projects: await github.listAllPulls(state.read().projects) }));

  /**
   * Open pull requests for this project's repository.
   *
   * Per project, from its own `origin` — never a browser of every repository the account can see. Failures
   * come back as a state with an explanation rather than an error: a repository the signed-in account cannot
   * read is something the page should say out loud, since GitHub answers identically for "does not exist".
   */
  app.get<{ Params: { id: string } }>('/api/projects/:id/pulls', async (req, reply) => {
    const project = state.findProject(req.params.id);
    if (!project) return notFound(reply, 'No such project.');
    return github.listPulls(project);
  });

  /** One pull request in full: the facts, the patch, and the last review of it if there is one. */
  app.get<{ Params: { id: string; number: string } }>('/api/projects/:id/pulls/:number', async (req, reply) => {
    const project = state.findProject(req.params.id);
    if (!project) return notFound(reply, 'No such project.');
    const number = Number.parseInt(req.params.number, 10);
    if (!Number.isInteger(number) || number <= 0) return badRequest(reply, 'That is not a pull request number.');

    const detail = await github.pullDetail(project, number);
    if (!('pull' in detail)) return badRequest(reply, detail.reason, 'PULL_UNREADABLE');
    return { ...detail, last: review.lastFor(project.id, number) };
  });

  /**
   * Review one pull request.
   *
   * Its commit is fetched into `refs/flightdeck/pr-N` first — a ref in a namespace this tool owns, with no
   * checkout and no working-tree change — so the agent can read whole files at the pull request's own revision.
   * Reviewing a patch alone produces confident nonsense about a file whose local copy is a different file.
   */
  app.post<{ Params: { id: string; number: string }; Body: { model?: string } }>(
    '/api/projects/:id/pulls/:number/review',
    async (req, reply) => {
      const project = state.findProject(req.params.id);
      if (!project) return notFound(reply, 'No such project.');
      const number = Number.parseInt(req.params.number, 10);
      if (!Number.isInteger(number) || number <= 0) return badRequest(reply, 'That is not a pull request number.');

      const detail = await github.pullDetail(project, number);
      if (!('pull' in detail)) return badRequest(reply, detail.reason, 'PULL_UNREADABLE');

      const fetched = await github.fetchPullRef(project, number, `origin/${detail.pull.base}`);
      if ('reason' in fetched) return badRequest(reply, fetched.reason, 'FETCH_FAILED');

      const chat = review.reviewChat(project, req.body?.model);
      const startedAt = new Date().toISOString();
      const send = openStream(reply);

      let text = '';
      let costUsd: number | null = null;
      let error: string | null = null;
      let clientGone = false;
      reply.raw.on('close', () => {
        clientGone = true;
        void agent.abort(chat.id);
      });

      const prompt = review.buildPullPrompt({
        number,
        title: detail.pull.title,
        author: detail.pull.author,
        base: detail.pull.base,
        ref: fetched.ref,
        mergeBase: fetched.mergeBase,
        files: detail.files
      });

      await agent.send(
        project,
        chat,
        prompt,
        false,
        (event) => {
          if (!clientGone) send(event);
          if (event.type === 'text') text += event.delta;
          if (event.type === 'error') error = event.detail ? `${event.message} — ${event.detail}` : event.message;
          if (event.type === 'rate_limit') {
            state.update((s) => {
              s.lastRateLimit = {
                resetsAt: event.resetsAt,
                rateLimitType: event.rateLimitType,
                seenAt: new Date().toISOString()
              };
            });
          }
          if (event.type === 'done') {
            costUsd = event.costUsd ?? null;
            if (event.isError && !error) error = event.result ?? 'The review ended without finishing.';
            usage.append({
              at: new Date().toISOString(),
              projectId: project.id,
              chatId: chat.id,
              model: event.usage?.model ?? chat.model ?? null,
              numTurns: event.numTurns ?? 0,
              durationMs: event.durationMs ?? 0,
              costUsd: event.costUsd ?? 0,
              inputTokens: event.usage?.inputTokens ?? 0,
              outputTokens: event.usage?.outputTokens ?? 0,
              cacheReadTokens: event.usage?.cacheReadTokens ?? 0,
              cacheCreationTokens: event.usage?.cacheCreationTokens ?? 0,
              isError: event.isError,
              denials: event.denials.length
            });
          }
        },
        state.read().settings?.maxTurns ?? 0
      );

      const { summary, findings, parsed } = review.parseReview(text);
      const result: ReviewResult = {
        projectId: project.id,
        pull: number,
        base: detail.pull.base,
        branch: detail.pull.head,
        startedAt,
        finishedAt: new Date().toISOString(),
        summary,
        findings: review.rank(findings),
        raw: text,
        parsed,
        costUsd,
        error
      };
      review.remember(result);

      if (!clientGone) {
        send({ type: 'review', review: result });
        reply.raw.end();
      }
      return reply;
    }
  );

  app.post<{ Params: { id: string }; Body: { model?: string } }>(
    '/api/projects/:id/review',
    async (req, reply) => {
      const project = state.findProject(req.params.id);
      if (!project) return notFound(reply, 'No such project.');

      const context = await review.resolveContext(project, project.fastForwardRef ?? null);
      // Refused rather than run: a review of an empty diff costs real tokens to be told nothing.
      if (context.reason) return badRequest(reply, context.reason, 'NOTHING_TO_REVIEW');

      const chat = review.reviewChat(project, req.body?.model);
      const startedAt = new Date().toISOString();
      const send = openStream(reply);

      let text = '';
      let costUsd: number | null = null;
      let error: string | null = null;

      /*
       * Writing to a socket nobody is holding open throws, and the run continues past the close — the chat
       * route has always tracked this and the first version of this one did not. Found by the first review
       * this feature ever ran, against its own diff.
       */
      let clientGone = false;
      reply.raw.on('close', () => {
        clientGone = true;
        // A closed tab must not leave a review running against a repository.
        void agent.abort(chat.id);
      });

      await agent.send(
        project,
        chat,
        review.buildPrompt(context),
        false,
        (event) => {
        if (!clientGone) send(event);

        // The findings live in the assistant's own text, so it is accumulated as it streams rather than
        // read back from a transcript afterwards.
        if (event.type === 'text') text += event.delta;
        if (event.type === 'error') error = event.detail ? `${event.message} — ${event.detail}` : event.message;
        /*
         * The quota window, kept for the same reason a chat keeps it: the CLI mentions it only while a run is
         * in flight, and the usage view still has to bound "this window" after a reload. A review spends the
         * same quota as any other run, so it must not be the one path that drops this.
         */
        if (event.type === 'rate_limit') {
          state.update((s) => {
            s.lastRateLimit = {
              resetsAt: event.resetsAt,
              rateLimitType: event.rateLimitType,
              seenAt: new Date().toISOString()
            };
          });
        }
        if (event.type === 'done') {
          costUsd = event.costUsd ?? null;
          if (event.isError && !error) error = event.result ?? 'The review ended without finishing.';
          // Recorded whether or not the tab is still listening: the run happened and it spent quota.
          usage.append({
            at: new Date().toISOString(),
            projectId: project.id,
            chatId: chat.id,
            model: event.usage?.model ?? chat.model ?? null,
            numTurns: event.numTurns ?? 0,
            durationMs: event.durationMs ?? 0,
            costUsd: event.costUsd ?? 0,
            inputTokens: event.usage?.inputTokens ?? 0,
            outputTokens: event.usage?.outputTokens ?? 0,
            cacheReadTokens: event.usage?.cacheReadTokens ?? 0,
            cacheCreationTokens: event.usage?.cacheCreationTokens ?? 0,
            isError: event.isError,
            denials: event.denials.length
          });
        }
        },
        // The same cap a chat turn obeys. A review that reads twenty files takes turns to do it, so a user who
        // has set a cap for cost reasons means it here too.
        state.read().settings?.maxTurns ?? 0
      );

      const { summary, findings, parsed } = review.parseReview(text);
      const result: ReviewResult = {
        projectId: project.id,
        pull: null,
        base: context.baseRef,
        branch: context.branch,
        startedAt,
        finishedAt: new Date().toISOString(),
        summary,
        findings: review.rank(findings),
        raw: text,
        parsed,
        costUsd,
        error
      };
      review.remember(result);

      if (!clientGone) {
        send({ type: 'review', review: result });
        reply.raw.end();
      }
      return reply;
    }
  );
}
