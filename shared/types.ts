/**
 * Contracts shared by both halves of the app. The server imports these to build
 * responses, the client to consume them — so a shape can never drift between them.
 */

export type PermissionMode = 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface Project {
  id: string;
  name: string;
  /** Absolute path to the repo root. The only place a project path is trusted. */
  path: string;
  addedAt: string;
  defaultPermissionMode: PermissionMode;
  /** Optional command that means "is this project still healthy", e.g. `npm run build`. */
  verifyCommand?: string;
}

export interface Chat {
  id: string;
  projectId: string;
  /** Set when this chat is a sub-chat; grouping only, no behavioural difference. */
  parentChatId: string | null;
  title: string;
  /** The `--session-id` UUID handed to the CLI. Also the transcript's identity. */
  sessionId: string;
  permissionMode: PermissionMode;
  createdAt: string;
  lastMessageAt: string | null;
}

/** Who a commit in a given repository would be attributed to, and where that came from. */
export interface GitIdentity {
  name: string | null;
  email: string | null;
  /** `local` = this repo overrides, `global` = machine default, `none` = git would refuse. */
  scope: 'local' | 'global' | 'none';
}

/** A remembered identity, so switching is a click rather than two config commands. */
export interface SavedIdentity {
  id: string;
  label: string;
  name: string;
  email: string;
}

export interface IdentityState {
  current: GitIdentity;
  saved: SavedIdentity[];
}

export interface AppState {
  version: 1;
  /** Where the add-project picker reopens. Null until the user has browsed once — there
   *  is deliberately no default projects directory (see DECISIONS.md). */
  lastBrowsedDir: string | null;
  projects: Project[];
  chats: Chat[];
  /** Identities offered in the switcher. Never applied automatically — switching is always
   *  an explicit act, because it rewrites who authors the next commit. */
  identities: SavedIdentity[];
  /** Persisted panel widths, keyed by panel id. */
  layout: Record<string, number>;
}

// ─── The agent stream, as the client sees it ─────────────────────────────────
// Raw `stream-json` from the CLI never reaches the browser; server/stream.ts
// translates it into exactly these. See API.md.

export interface SessionEvent {
  type: 'session';
  sessionId: string;
  model: string;
  cwd: string;
  permissionMode: string;
  tools: string[];
}

/** A user's message. Only produced by history replay — during a live run the client
 *  already knows what it just sent. */
export interface PromptEvent {
  type: 'prompt';
  text: string;
}

export interface TextEvent {
  type: 'text';
  delta: string;
}

export interface ToolStartEvent {
  type: 'tool_start';
  id: string;
  name: string;
  input: unknown;
  /** Non-null when the call came from a subagent, so the UI can nest it. */
  parentToolUseId: string | null;
}

export interface ToolResultEvent {
  type: 'tool_result';
  id: string;
  content: string;
  isError: boolean;
}

export interface TurnEndEvent {
  type: 'turn_end';
  stopReason: string | null;
}

export interface RateLimitEvent {
  type: 'rate_limit';
  status: string;
  /** Unix seconds. */
  resetsAt: number | null;
  rateLimitType: string | null;
}

export interface DoneEvent {
  type: 'done';
  isError: boolean;
  result: string | null;
  numTurns: number | null;
  durationMs: number | null;
  /** Notional API-equivalent cost. NOT money billed on a subscription. */
  costUsd: number | null;
  denials: unknown[];
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  detail?: string;
}

export type UiEvent =
  | PromptEvent
  | SessionEvent
  | TextEvent
  | ToolStartEvent
  | ToolResultEvent
  | TurnEndEvent
  | RateLimitEvent
  | DoneEvent
  | ErrorEvent;

// ─── Git ────────────────────────────────────────────────────────────────────

export interface GitFile {
  path: string;
  /** Porcelain-ish status: M, A, D, R, ?, etc. */
  status: string;
}

/** A path that could not be staged, and the reason in words the user can act on. */
export interface SkippedPath {
  path: string;
  reason: string;
}

/** Staging is partial by design: one unstageable path must not sink the whole batch. */
export interface StageResult {
  status: GitStatus;
  skipped: SkippedPath[];
}

/** Result of fetch / pull / push. `summary` is git's own human-readable output. */
export interface RemoteResult {
  summary: string;
  status: GitStatus;
}

export interface StashEntry {
  index: number;
  /** `stash@{0}` — git's own ref, used for pop. */
  ref: string;
  subject: string;
  /** Relative time, as git formats it ("2 hours ago"). */
  when: string;
}

export interface GitStatus {
  branch: string | null;
  /** Upstream ref (`origin/main`), or null when the branch has never been pushed. */
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
}

// ─── Filesystem browsing (add-project picker) ───────────────────────────────

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** True when the directory is itself a git repo — the picker highlights these. */
  isRepo: boolean;
}

/** One changed line in a parsed unified diff. */
export interface DiffLine {
  kind: 'add' | 'del' | 'context' | 'meta';
  /** Line number in the pre-image, null for additions. */
  oldNumber: number | null;
  /** Line number in the post-image, null for deletions. */
  newNumber: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface BrowseResult {
  dir: string;
  parent: string | null;
  entries: DirEntry[];
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Every failed request returns this shape, so the client has one error path. */
export interface ApiError {
  error: {
    message: string;
    /** Raw stderr from git/claude, verbatim. Never summarised. */
    detail?: string;
    code?: string;
  };
}
