import test from 'node:test';
import assert from 'node:assert/strict';
import type { UiEvent } from '../shared/types.ts';
import { EMPTY_VIEW, foldTask } from '../client/features/workflow/foldTask.ts';
import { translate } from '../server/stream.ts';
import { agentsJson, isSafeCommand, isSafeRule } from '../server/workflow.ts';
import { DEFAULT_ROLES } from '../shared/workflow.ts';

/**
 * A task's view is built from events alone.
 *
 * The shapes below are the ones a real delegated run produced on Claude Code 2.1.287: the lead edits a file,
 * starts a specialist, the specialist runs a check and is denied another command, and reports back.
 */
const start = (id: string, name: string, input: unknown, parent: string | null = null): UiEvent => ({
  type: 'tool_start',
  id,
  name,
  input,
  parentToolUseId: parent
});
const result = (id: string, content: string, isError = false): UiEvent => ({ type: 'tool_result', id, content, isError });

const RUN: UiEvent[] = [
  { type: 'prompt', text: 'Add sub()' },
  start('t1', 'TodoWrite', { todos: [{ content: 'Add sub', status: 'in_progress' }] }),
  start('t2', 'Edit', { file_path: 'C:/repos/app/add.js' }),
  result('t2', 'ok'),
  start('a1', 'Agent', { subagent_type: 'qa', description: 'Run tests' }),
  { type: 'agent_start', id: 'a1', agentId: 'agent-1', role: 'qa', description: 'Run tests', prompt: 'Run npm test' },
  start('s1', 'PowerShell', { command: 'npm test' }, 'a1'),
  { type: 'agent_progress', id: 'a1', description: 'Running npm test', toolUses: 1, totalTokens: 100 },
  result('s1', 'tests 3\npass 3'),
  { type: 'denied', toolName: 'PowerShell', message: 'requires approval: node x.js', agentId: 'agent-1' },
  { type: 'agent_end', id: 'a1', status: 'completed', summary: 'npm test passed' },
  { type: 'text', delta: 'Done.' }
];

test('a specialist gets a lane holding its brief, its tool calls and its report', () => {
  const view = foldTask(EMPTY_VIEW, RUN);
  assert.equal(view.agents.length, 1);
  const lane = view.agents[0]!;
  assert.equal(lane.role, 'qa');
  assert.equal(lane.prompt, 'Run npm test');
  assert.equal(lane.status, 'done');
  assert.equal(lane.summary, 'npm test passed');
  assert.deepEqual(lane.tools.map((tool) => tool.name), ['PowerShell']);
  assert.equal(lane.tools[0]!.result, 'tests 3\npass 3');
});

test("a specialist's tool calls stay out of the lead's transcript", () => {
  const view = foldTask(EMPTY_VIEW, RUN);
  const leadTools = view.blocks.flatMap((block) => (block.kind === 'tool' ? [block.tool.id] : []));
  assert.deepEqual(leadTools, ['t1', 't2', 'a1']);
});

test('files, checks and denials are attributed to whoever did them', () => {
  const view = foldTask(EMPTY_VIEW, RUN);
  assert.deepEqual(view.files, [{ path: 'C:/repos/app/add.js', by: ['lead'] }]);
  assert.equal(view.commands.length, 1);
  assert.deepEqual(
    { by: view.commands[0]!.by, isCheck: view.commands[0]!.isCheck, isError: view.commands[0]!.isError },
    { by: 'qa', isCheck: true, isError: false }
  );
  assert.deepEqual(view.denials.map((denial) => denial.by), ['qa']);
  assert.deepEqual(view.todos, [{ content: 'Add sub', status: 'in_progress' }]);
});

test('the stage follows the most recent kind of work, and can go back', () => {
  assert.equal(foldTask(EMPTY_VIEW, RUN.slice(0, 2)).stage, 'Planning');
  assert.equal(foldTask(EMPTY_VIEW, RUN.slice(0, 3)).stage, 'Implementing');
  const tested = foldTask(EMPTY_VIEW, RUN);
  assert.equal(tested.stage, 'Testing');
  // A failed check sends the lead back to the code; the stage says so rather than staying on Testing.
  assert.equal(foldTask(tested, [start('t9', 'Edit', { file_path: 'C:/repos/app/add.js' })]).stage, 'Implementing');
});

test('folding in two batches gives the same view as folding at once', () => {
  const once = foldTask(EMPTY_VIEW, RUN);
  const twice = foldTask(foldTask(EMPTY_VIEW, RUN.slice(0, 6)), RUN.slice(6));
  const shape = (view: typeof once) => ({
    agents: view.agents.map((lane) => ({ ...lane, tools: lane.tools.map((tool) => tool.id) })),
    files: view.files,
    stage: view.stage,
    blocks: view.blocks.map((block) => block.id)
  });
  assert.deepEqual(shape(twice), shape(once));
});

test('several done events are summed rather than ending the task', () => {
  const done = (turns: number): UiEvent => ({
    type: 'done',
    isError: false,
    result: 'r',
    numTurns: turns,
    durationMs: 1000,
    costUsd: 0.01,
    denials: [],
    usage: null,
    subtype: 'success',
    apiErrorStatus: null
  });
  const view = foldTask(EMPTY_VIEW, [done(2), done(3)]);
  assert.deepEqual(view.totals, { turns: 5, durationMs: 2000, costUsd: 0.02 });
  assert.equal(view.errors.length, 0);
});

test('the CLI records for a specialist translate into lane events', () => {
  assert.deepEqual(
    translate({
      type: 'system',
      subtype: 'task_started',
      task_id: 'agent-1',
      tool_use_id: 'a1',
      description: 'Run tests',
      subagent_type: 'qa',
      prompt: 'Run npm test'
    }),
    [{ type: 'agent_start', id: 'a1', agentId: 'agent-1', role: 'qa', description: 'Run tests', prompt: 'Run npm test' }]
  );
  assert.deepEqual(
    translate({ type: 'system', subtype: 'permission_denied', tool_name: 'PowerShell', message: 'no', agent_id: 'agent-1' }),
    [{ type: 'denied', toolName: 'PowerShell', message: 'no', agentId: 'agent-1' }]
  );
});

test("a specialist's partial text is not spliced into the lead's reply", () => {
  const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
  assert.equal(translate({ type: 'stream_event', event: delta, parent_tool_use_id: 'a1' }).length, 0);
  assert.equal(translate({ type: 'stream_event', event: delta }).length, 1);
});

test('only enabled roles are handed to the CLI, with a short model name', () => {
  const roles = [
    { ...DEFAULT_ROLES[0]!, model: 'claude-sonnet-5' },
    { ...DEFAULT_ROLES[1]!, enabled: false }
  ];
  const parsed = JSON.parse(agentsJson(roles)) as Record<string, { model?: string }>;
  assert.deepEqual(Object.keys(parsed), ['frontend']);
  assert.equal(parsed.frontend!.model, 'sonnet');
});

test('a command or rule that could break out of its argument is refused', () => {
  assert.equal(isSafeCommand('npm test'), true);
  assert.equal(isSafeCommand('--dangerously-skip-permissions'), false);
  assert.equal(isSafeCommand('npm test) Bash(rm'), false);
  assert.equal(isSafeCommand('npm test\nrm'), false);
  assert.equal(isSafeRule('mcp__plugin_playwright_playwright'), true);
  assert.equal(isSafeRule('-x'), false);
});
