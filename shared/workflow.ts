/**
 * The development workflow: a task handed to a Lead Engineer session, which may delegate to specialist roles.
 *
 * Shared by both halves like everything in this folder. The defaults live here rather than in the server
 * because the settings page shows them, and "reset to default" has to mean the same text in both places.
 *
 * WHAT THIS IS NOT. Flight Deck does not route work between agents. One `claude` process runs per task; the
 * roles below are handed to it as agent definitions and the CLI's own delegation does the rest. See
 * DECISIONS.md — "Workflow: delegation inside one session".
 */

/** A specialist the lead can delegate to. Becomes one entry of the CLI's `--agents` JSON. */
export interface AgentRole {
  /** The name the lead delegates by. Lowercase letters, digits and dashes — it is an identifier in the CLI. */
  id: string;
  /** Shown in the UI. */
  name: string;
  /** When the lead should reach for this role. The lead reads this to decide. */
  description: string;
  /** The role's own instructions. */
  prompt: string;
  /** A model id from `MODEL_OPTIONS`, or empty for the lead's model. */
  model: string;
  /** A disabled role is not offered to the lead at all. */
  enabled: boolean;
}

export interface WorkflowSettings {
  /** Appended to the lead session's system prompt. */
  leadPrompt: string;
  roles: AgentRole[];
  /**
   * Extra permission rules allowed without asking, in the CLI's own rule syntax — typically MCP servers
   * used for browser verification (`mcp__<server>`).
   *
   * Needed because a headless run has no approval channel: a tool that would prompt is simply denied.
   */
  allowedTools: string[];
}

export const DEFAULT_LEAD_PROMPT = `You are the Lead Engineer for a development task in this repository.

Work in this order:
1. Understand the task. Read the project notes file named below if it exists, then inspect the actual source — do not assume the architecture from documentation.
2. Plan. Keep a short todo list with the TodoWrite tool and update it as you go, so progress is visible.
3. Implement. Do the whole task yourself unless it genuinely splits into independent parts. Delegate only when the parts touch different files; give each specialist a precise brief, the files it owns, and any interface it must match. Never have two agents edit the same file.
4. Verify. Run the project's own checks (typecheck, lint, tests, build). For UI changes, check the result in a browser if a browser tool is available. If a check or a tool is unavailable or denied, say so plainly — never report a check you did not run.
5. Report. Finish with a final report: what changed, which checks ran and their results, what was not verified, and any outstanding issue.

Rules:
- Edit the working tree only. Never commit, push, switch or create branches, stash, or reset — the human reviews the diff and commits.
- Follow the conventions already in the code. Add no dependency unless the task requires it.
- Leave unrelated changes alone.
- Do not say the task is complete if a check failed or was skipped.
- When you learn something about this project that a future task would otherwise have to rediscover (stack, layout, commands, conventions, pitfalls), update the project notes file. Keep it short and factual.`;

export const DEFAULT_ROLES: AgentRole[] = [
  {
    id: 'frontend',
    name: 'Frontend Engineer',
    description:
      'Implements UI and client-side changes. Use for an independent frontend part of a task, with the files it owns named in the brief.',
    prompt:
      'You are the Frontend Engineer. Implement the UI work you were briefed on, following the design and component conventions already in this codebase. Stay inside the files you were given. Add or update frontend tests where the project has them. Do not commit or touch git. Report what you changed and anything the lead must know.',
    model: '',
    enabled: true
  },
  {
    id: 'backend',
    name: 'Backend Engineer',
    description:
      'Implements APIs, server-side logic and data access. Use for an independent backend part of a task, with the files it owns named in the brief.',
    prompt:
      'You are the Backend Engineer. Implement the server-side work you were briefed on, keeping the existing architecture and API contracts unless the brief says otherwise. Stay inside the files you were given. Add or update backend tests where the project has them. Do not commit or touch git. Report what you changed, including any contract the frontend depends on.',
    model: '',
    enabled: true
  },
  {
    id: 'qa',
    name: 'QA / Testing',
    description:
      'Validates a finished change: runs the test suite, type checks, lint and build, exercises the affected user flow in a browser when a browser tool is available, and reports failures.',
    prompt:
      'You are the QA agent. Validate the change you were briefed on. Run the project\'s existing checks and, when a browser tool is available, exercise the affected flow and look for console and network errors. Do not fix code — report. For every check say whether it passed, failed, or could not be run and why. Never report a check you did not actually run.',
    model: '',
    enabled: true
  }
];

export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = {
  leadPrompt: DEFAULT_LEAD_PROMPT,
  roles: DEFAULT_ROLES,
  // The two browser servers Claude Code's own plugins ship. A machine without them loses nothing: an
  // allow rule for a server that is not connected matches no tool.
  allowedTools: ['mcp__plugin_playwright_playwright', 'mcp__plugin_chrome-devtools-mcp_chrome-devtools']
};

/**
 * Where a task is.
 *
 * `running` is not stored — a task is running exactly when its process is alive, and persisting that would
 * leave every task "running" forever after a server restart.
 */
export type TaskStatus = 'idle' | 'done' | 'failed' | 'stopped';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  /** What was asked for, verbatim. */
  description: string;
  /** The lead session's id, handed to the CLI. Follow-ups resume it. */
  sessionId: string;
  /** Empty means the CLI's default model. */
  model: string;
  /** How the last run ended. */
  status: TaskStatus;
  /** The lead's final message from the last run. */
  report: string | null;
  /** How many times this task has been sent to the CLI — the first run claims the session, later ones resume. */
  runs: number;
  createdAt: string;
  updatedAt: string;
}

/** A task as the list shows it. */
export interface TaskSummary extends Task {
  running: boolean;
}

/** What the lead may run without asking, and what it knows about the project going in. */
export interface ProjectWorkflowConfig {
  /**
   * Shell commands allowed without approval, as prefixes: `npm test` also allows `npm test -- --watch`.
   * Null means "use the detected ones".
   */
  commands: string[] | null;
  /** What `commands` falls back to: the project's own check scripts, read from package.json. */
  detected: string[];
  /** The project notes the lead reads first and keeps up to date. */
  knowledge: string;
}
