/**
 * Drafting a commit message from what is staged.
 *
 * The diff goes into the prompt rather than the model being told to fetch it: the server already
 * has it, and an inline diff means the helper needs no tools at all (see `oneshot.ts`, which
 * denies them).
 *
 * The result is only ever a suggestion. It lands in the message box for editing and never
 * triggers a commit — same rule as everywhere else in this app: the agent writes, the human
 * commits.
 */
import type { FastifyInstance } from 'fastify';
import type { CommitMessageDraft } from '@shared/types';
import { messageOf, runGit } from '../git-exec.js';
import { ask } from '../oneshot.js';
import * as state from '../state.js';
import { badRequest, notFound, serverError } from '../errors.js';

/**
 * How much diff to send.
 *
 * The prompt travels on stdin, so there is no command-line limit to respect — this cap exists
 * only because a commit message does not get better for seeing a megabyte of changes, and every
 * character is context the model pays for. The file list plus a long stretch of the diff carries
 * the intent.
 *
 * Truncation is disclosed to the model *and* to the caller rather than hidden.
 */
export const MAX_DIFF_CHARS = 120_000;

export function buildPrompt(stat: string, diff: string, truncated: boolean): string {
  return [
    'Write a git commit message for the staged changes below.',
    '',
    'Rules:',
    '- First line: imperative mood, under 72 characters, no trailing period.',
    '- Then a blank line, then 1-3 short lines explaining WHY, only if the reason is not obvious',
    '  from the subject. Skip the body entirely for a small, self-evident change.',
    '- Describe the change, not the diff. Never list file names that add nothing.',
    '- Match the style of this repository if its recent history or CLAUDE.md implies one',
    '  (for example Conventional Commits).',
    '- Output ONLY the commit message. No preamble, no code fences, no commentary.',
    '',
    'Files changed:',
    stat.trim() || '(none reported)',
    '',
    truncated
      ? `Staged diff (TRUNCATED to the first ${MAX_DIFF_CHARS} characters — describe the change as a whole, do not claim it is complete):`
      : 'Staged diff:',
    diff
  ].join('\n');
}

/** Models sometimes wrap output in fences despite being told not to; strip them rather than
 *  putting backticks in someone's commit history. */
export function cleanMessage(text: string): string {
  let out = text.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/;
  const match = fence.exec(out);
  if (match?.[1]) out = match[1];
  return out.trim();
}

export async function commitMessageRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { projectId?: string; model?: string } }>(
    '/api/git/commit-message',
    async (req, reply): Promise<CommitMessageDraft | ReturnType<typeof serverError>> => {
      const project = req.body?.projectId ? state.findProject(req.body.projectId) : undefined;
      if (!project) return notFound(reply, 'No such project.');

      const [stat, diff] = await Promise.all([
        runGit(project.path, ['diff', '--staged', '--stat']),
        runGit(project.path, ['diff', '--staged'])
      ]);
      if (!diff.ok) return serverError(reply, 'Could not read the staged diff.', messageOf(diff));

      const full = diff.stdout;
      if (!full.trim()) {
        return badRequest(reply, 'Nothing is staged — stage the changes you want described.', 'NOTHING_STAGED');
      }

      const truncated = full.length > MAX_DIFF_CHARS;
      const prompt = buildPrompt(stat.stdout, truncated ? full.slice(0, MAX_DIFF_CHARS) : full, truncated);

      const result = await ask(project.path, prompt, req.body?.model);
      if (!result.ok || !result.text) {
        return serverError(reply, 'Could not draft a commit message.', result.error ?? 'The model returned nothing.');
      }

      return {
        message: cleanMessage(result.text),
        truncated,
        costUsd: result.costUsd,
        model: result.model
      };
    }
  );
}
