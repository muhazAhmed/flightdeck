import type { UiEvent } from '@shared/types';
import type { Block, ToolInvocation } from '@/features/chat/useChatStream';

/**
 * Where a task is, read off what its agents have actually done.
 *
 * Derived, never declared: asking the lead to announce its own stage would show whatever it said, and a lead
 * that says "testing" while editing files is exactly the report this page exists to check. So the stage is the
 * most recent kind of work observed — which also means it can go back from Testing to Implementing when a
 * failed check sends the lead back to the code, and that is the truth.
 */
export type Stage = 'Understanding' | 'Planning' | 'Implementing' | 'Testing';

export interface AgentLane {
  /** The lead's tool call that started this specialist; its own tool calls carry it as their parent. */
  id: string;
  agentId: string;
  role: string;
  description: string;
  /** The brief the lead gave it. */
  prompt: string;
  status: 'running' | 'done' | 'failed';
  /** What it is doing right now, in the CLI's words. */
  progress: string;
  toolUses: number;
  totalTokens: number;
  tools: ToolInvocation[];
  /** Its final report to the lead. */
  summary: string;
}

export interface CommandRun {
  id: string;
  command: string;
  /** `lead`, or the role id of the specialist that ran it. */
  by: string;
  /** A test, lint, type check or build — as opposed to an `ls`. */
  isCheck: boolean;
  result: string | null;
  isError: boolean;
}

export interface TouchedFile {
  path: string;
  by: string[];
}

export interface Denial {
  toolName: string;
  message: string;
  by: string;
}

export interface Todo {
  content: string;
  status: string;
}

export interface TaskView {
  /** The lead's own transcript: prompts, prose and tool calls. */
  blocks: Block[];
  agents: AgentLane[];
  files: TouchedFile[];
  commands: CommandRun[];
  /** Browser-tool calls, by anyone. */
  browser: (ToolInvocation & { by: string })[];
  denials: Denial[];
  errors: { message: string; detail?: string }[];
  todos: Todo[];
  /** Browser-capable MCP servers the CLI reported, with their connection status. */
  browserServers: { name: string; status: string }[];
  stage: Stage;
  model: string | null;
  totals: { turns: number; durationMs: number; costUsd: number };
}

export const EMPTY_VIEW: TaskView = {
  blocks: [],
  agents: [],
  files: [],
  commands: [],
  browser: [],
  denials: [],
  errors: [],
  todos: [],
  browserServers: [],
  stage: 'Understanding',
  model: null,
  totals: { turns: 0, durationMs: 0, costUsd: 0 }
};

const WRITERS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
// The shell tool is named per platform — `PowerShell` on Windows, `Bash` elsewhere. See touchesWorkingTree.ts.
const SHELLS = new Set(['Bash', 'PowerShell']);
// `Agent` is what this CLI calls delegation; `Task` is what older ones called it.
const DELEGATES = new Set(['Agent', 'Task']);

const CHECK = /\b(test|tests|lint|eslint|typecheck|type-check|tsc|build|vitest|jest|playwright|pytest|cargo (test|check|build)|go (test|build|vet))\b/i;
const BROWSER = /playwright|chrome|devtools|browser|puppeteer/i;

function field(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isBrowserTool(name: string): boolean {
  return name.startsWith('mcp__') && BROWSER.test(name);
}

/**
 * Fold new events into a task's view.
 *
 * Incremental, like the chat reducer it sits beside: the same function replays a finished task's log and
 * follows a live one, so the two cannot disagree. Every array it changes is copied first — the previous view
 * is what React is still holding.
 */
export function foldTask(previous: TaskView, events: UiEvent[]): TaskView {
  if (events.length === 0) return previous;

  const blocks = [...previous.blocks];
  const agents = previous.agents.map((lane) => ({ ...lane, tools: [...lane.tools] }));
  const files = previous.files.map((file) => ({ ...file, by: [...file.by] }));
  const commands = [...previous.commands];
  const browser = [...previous.browser];
  const denials = [...previous.denials];
  const errors = [...previous.errors];
  let { todos, browserServers, stage, model } = previous;
  const totals = { ...previous.totals };

  const lane = (id: string) => agents.find((candidate) => candidate.id === id);
  const roleOf = (parentId: string | null) => (parentId ? (lane(parentId)?.role ?? 'agent') : 'lead');

  for (const event of events) {
    switch (event.type) {
      case 'session':
        model = event.model || model;
        browserServers = (event.mcpServers ?? []).filter((server) => BROWSER.test(server.name));
        break;

      case 'prompt':
        blocks.push({ kind: 'prompt', id: `prompt-${blocks.length}`, text: event.text });
        break;

      case 'text': {
        const last = blocks.at(-1);
        if (last?.kind === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
        else blocks.push({ kind: 'text', id: `text-${blocks.length}`, text: event.delta });
        break;
      }

      case 'tool_start': {
        const tool: ToolInvocation = {
          id: event.id,
          name: event.name,
          input: event.input,
          result: null,
          isError: false,
          startedAt: Date.now(),
          finishedAt: null
        };
        const by = roleOf(event.parentToolUseId);

        if (event.parentToolUseId) {
          // A call can arrive a beat before the CLI announces the specialist that made it; the lane is created
          // here and filled in when the announcement lands.
          let owner = lane(event.parentToolUseId);
          if (!owner) {
            owner = {
              id: event.parentToolUseId,
              agentId: '',
              role: 'agent',
              description: '',
              prompt: '',
              status: 'running',
              progress: '',
              toolUses: 0,
              totalTokens: 0,
              tools: [],
              summary: ''
            };
            agents.push(owner);
          }
          owner.tools.push(tool);
        } else {
          blocks.push({ kind: 'tool', id: event.id, tool });
        }

        if (event.name === 'TodoWrite' && !event.parentToolUseId) {
          const raw = (event.input as { todos?: unknown } | null)?.todos;
          if (Array.isArray(raw)) {
            todos = raw
              .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
              .map((item) => ({ content: String(item.content ?? ''), status: String(item.status ?? 'pending') }));
          }
          if (stage === 'Understanding') stage = 'Planning';
        }

        if (WRITERS.has(event.name)) {
          const path = field(event.input, 'file_path') ?? field(event.input, 'notebook_path');
          if (path) {
            const known = files.find((file) => file.path === path);
            if (!known) files.push({ path, by: [by] });
            else if (!known.by.includes(by)) known.by.push(by);
          }
          stage = 'Implementing';
        }

        if (SHELLS.has(event.name)) {
          const command = field(event.input, 'command') ?? '';
          const isCheck = CHECK.test(command);
          commands.push({ id: event.id, command, by, isCheck, result: null, isError: false });
          if (isCheck) stage = 'Testing';
        }

        if (isBrowserTool(event.name)) {
          browser.push({ ...tool, by });
          stage = 'Testing';
        }
        break;
      }

      case 'tool_result': {
        const finished = { result: event.content, isError: event.isError, finishedAt: Date.now() };

        const blockIndex = blocks.findIndex((block) => block.kind === 'tool' && block.tool.id === event.id);
        if (blockIndex >= 0) {
          const block = blocks[blockIndex] as Extract<Block, { kind: 'tool' }>;
          blocks[blockIndex] = { ...block, tool: { ...block.tool, ...finished } };
        } else {
          for (const owner of agents) {
            const toolIndex = owner.tools.findIndex((tool) => tool.id === event.id);
            if (toolIndex >= 0) owner.tools[toolIndex] = { ...owner.tools[toolIndex]!, ...finished };
          }
        }

        const commandIndex = commands.findIndex((command) => command.id === event.id);
        if (commandIndex >= 0) {
          commands[commandIndex] = { ...commands[commandIndex]!, result: event.content, isError: event.isError };
        }
        const browserIndex = browser.findIndex((call) => call.id === event.id);
        if (browserIndex >= 0) browser[browserIndex] = { ...browser[browserIndex]!, ...finished };
        break;
      }

      case 'agent_start': {
        const existing = lane(event.id);
        const details = {
          agentId: event.agentId,
          role: event.role,
          description: event.description,
          prompt: event.prompt
        };
        if (existing) Object.assign(existing, details);
        else {
          agents.push({
            id: event.id,
            ...details,
            status: 'running',
            progress: '',
            toolUses: 0,
            totalTokens: 0,
            tools: [],
            summary: ''
          });
        }
        // A QA specialist starting is the task entering verification; any other is more implementation.
        stage = /qa|test/i.test(event.role) ? 'Testing' : 'Implementing';
        break;
      }

      case 'agent_progress': {
        const owner = lane(event.id);
        if (owner) {
          owner.progress = event.description;
          owner.toolUses = event.toolUses;
          owner.totalTokens = event.totalTokens;
        }
        break;
      }

      case 'agent_end': {
        const owner = lane(event.id);
        if (owner) {
          owner.status = event.status === 'completed' ? 'done' : 'failed';
          owner.summary = event.summary;
          owner.progress = '';
        }
        break;
      }

      case 'denied':
        denials.push({
          toolName: event.toolName,
          message: event.message,
          by: event.agentId ? (agents.find((candidate) => candidate.agentId === event.agentId)?.role ?? 'agent') : 'lead'
        });
        break;

      case 'error':
        errors.push({ message: event.message, detail: event.detail });
        break;

      case 'done':
        // One `done` per time the lead finishes a turn — a run that delegates produces several. They are
        // summed; whether the task is over is the server's to say, not this event's.
        totals.turns += event.numTurns ?? 0;
        totals.durationMs += event.durationMs ?? 0;
        totals.costUsd += event.costUsd ?? 0;
        if (event.isError) {
          errors.push({
            message: event.subtype && event.subtype !== 'success' ? `Run failed: ${event.subtype}` : 'The run failed.',
            detail: event.result ?? undefined
          });
        }
        break;

      case 'rate_limit':
      case 'turn_end':
        break;
    }
  }

  return { blocks, agents, files, commands, browser, denials, errors, todos, browserServers, stage, model, totals };
}

/** Delegation calls are shown as lanes, so the lead's transcript need not repeat them as tool cards. */
export function isDelegation(toolName: string): boolean {
  return DELEGATES.has(toolName);
}
