/**
 * Contracts shared by both halves of the app. The server imports these to build
 * responses, the client to consume them — so a shape can never drift between them.
 */

export type PermissionMode = 'acceptEdits' | 'plan' | 'bypassPermissions';

/**
 * Models offered in the picker. Ids are passed straight to `claude --model`, which also
 * accepts aliases — the full ids are used so a chat pins one model rather than drifting when
 * an alias moves.
 *
 * Omitting a model means the CLI's own default, which is what most chats should use.
 */
export interface ModelOption {
  id: string;
  label: string;
  /** One line on when to reach for it. */
  hint: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: '', label: 'Default', hint: 'Whatever your CLI is configured to use' },
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'Most capable — hard refactors, unfamiliar code' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Faster and cheaper for well-specified work' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Quick edits and mechanical changes' }
];

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
  /** Empty or absent means the CLI's default model. */
  model?: string;
  createdAt: string;
  lastMessageAt: string | null;
}

/**
 * A file handed to a prompt. The agent reads it from `path` with its own Read tool — images
 * included — so an attachment is a path, never an upload into the conversation.
 */
export interface Attachment {
  name: string;
  /** Absolute path on this machine. */
  path: string;
  sizeBytes: number;
  kind: 'image' | 'file';
}

/** A shell this machine actually has, offered in the terminal's profile picker. */
export interface ShellProfile {
  id: string;
  label: string;
  /** Absolute path to the executable, or a bare name resolved from PATH. */
  path: string;
  args: string[];
  /** Caveat worth showing next to the option, e.g. how WSL treats the working directory. */
  note?: string;
}

// ─── Terminal transport ──────────────────────────────────────────────────────
// JSON both ways: costs a little throughput, saves inventing a framing scheme for resize and exit.

export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type TerminalServerMessage =
  | { type: 'ready'; shell: string; shellId: string; cwd: string; scrollback: number }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string; detail?: string };

/** Whoever git says you are, machine-wide. Shown in the sidebar footer. */
export interface UserInfo {
  name: string | null;
  email: string | null;
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

/** A Claude Code session found on disk that Flight Deck has not adopted yet. */
export interface DiscoveredSession {
  sessionId: string;
  /** The opening human prompt, for recognising which conversation this is. */
  firstPrompt: string | null;
  sizeBytes: number;
  modifiedAt: string;
  /** Touched in the last few minutes, so probably open in another client. A heuristic —
   *  there is no reliable liveness signal — and presented as one. */
  active: boolean;
}

export type ThemeName = 'dark' | 'light';
export type AccentName = 'cyan' | 'violet' | 'blue' | 'green' | 'amber' | 'pink' | 'red';
export type Density = 'comfortable' | 'compact';
/** `all` confirms every source-control action; `destructive` only the ones with no undo. */
export type ConfirmLevel = 'all' | 'destructive';

/**
 * User preferences. Persisted server-side in the same state file as projects, so they survive a
 * reload and are shared by every browser tab pointed at this server.
 */
export interface Settings {
  theme: ThemeName;
  accent: AccentName;
  density: Density;
  confirmLevel: ConfirmLevel;
  /** Reopen the project that was selected when the app was last closed. */
  restoreLastProject: boolean;
  /** Terminal profile id from `ShellProfile`; empty means the best one detected. */
  terminalShell: string;
  terminalFontSize: number;
  terminalCursorBlink: boolean;
  /** Model for new chats. Empty means whatever the CLI is configured to use. */
  defaultModel: string;
  /** Permission mode given to projects as they are added. Existing projects keep theirs. */
  defaultPermissionMode: PermissionMode;
  /** Hard cap on turns per run, passed as `--max-turns`. 0 means no cap. */
  maxTurns: number;
  /** Append `Signed-off-by` to commits, using the identity the repo will attribute them to. */
  commitSignoff: boolean;
  /** Model that drafts commit messages. Empty means the CLI default. */
  draftModel: string;
  /** Set by the client as projects are selected; the seed for `restoreLastProject`. */
  lastProjectId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'cyan',
  density: 'comfortable',
  confirmLevel: 'all',
  restoreLastProject: true,
  terminalShell: '',
  terminalFontSize: 12.5,
  terminalCursorBlink: true,
  defaultModel: '',
  defaultPermissionMode: 'acceptEdits',
  maxTurns: 0,
  commitSignoff: false,
  draftModel: '',
  lastProjectId: null
};

// ─── Deck (cross-project overview) ───────────────────────────────────────

/**
 * One project's state, as the deck shows it.
 *
 * Everything here is answerable without an agent: git for the branch and counts, the filesystem for
 * how long work has been sitting, and Flight Deck's own chat records for when an agent last ran.
 */
export interface ProjectOverview {
  projectId: string;
  name: string;
  path: string;
  /** The folder is gone or is no longer a repository. Everything below is then null. */
  missing: boolean;
  branch: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  /** Subject and time of HEAD, so a card says what was last done here. */
  lastCommitSubject: string | null;
  lastCommitAt: string | null;
  /** ISO time of the OLDEST uncommitted change — how long work has been sitting, not when you last
   *  saved. Null when the tree is clean. */
  dirtySince: string | null;
  /** ISO time of the most recent message in any chat for this project, or null if never run. */
  lastAgentRunAt: string | null;
  /** git's own words when a repository could not be read. */
  error: string | null;
}

/** What Flight Deck has written outside your repositories, for the Privacy section. */
export interface StorageUsage {
  stateFile: string;
  attachmentsDir: string;
  attachmentCount: number;
  attachmentBytes: number;
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
  /** Absent in a state file written before settings existed; defaults fill in. */
  settings?: Settings;
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

export interface BranchInfo {
  name: string;
  current: boolean;
  /** Upstream in short form (`origin/main`), or null when the branch is local-only. */
  upstream: string | null;
  /** Subject of the branch's last commit — the fastest way to tell branches apart. */
  subject: string;
  /** Relative commit date, as git formats it. */
  when: string;
}

export interface BranchList {
  current: string | null;
  local: BranchInfo[];
  /** Short remote refs (`origin/feature-x`), excluding `origin/HEAD`. */
  remote: string[];
}

/** Result of a branch mutation: the summary, the new status, and the refreshed list. */
export interface BranchResult {
  summary: string;
  status: GitStatus | null;
  branches: BranchList;
}

/** A drafted commit message. Always a suggestion — it lands in the message box for editing and
 *  never triggers a commit. */
export interface CommitMessageDraft {
  message: string;
  /** True when the staged diff was too large to send whole, so the message describes a sample. */
  truncated: boolean;
  /** Notional API-equivalent cost, not money billed on a subscription. */
  costUsd: number | null;
  model: string | null;
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
