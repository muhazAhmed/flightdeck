# Flight Deck — API contracts

Two protocols matter: the **agent stream** (what `claude` emits and how it reaches the
browser) and the **HTTP/WS routes**. Everything about the agent stream below was
captured from a real run against Claude Code 2.1.233 — see
[`docs/stream-sample.jsonl`](./docs/stream-sample.jsonl).

---

## 1. The agent stream

### Invocation

```ts
spawn('claude', [
  '-p',
  '--output-format', 'stream-json',
  '--input-format',  'stream-json',
  '--include-partial-messages',
  '--verbose',                      // required for stream-json to emit fully
  '--session-id', chat.sessionId,   // must be a valid UUID
  '--permission-mode', chat.permissionMode,
], { cwd: project.path })
```

Resume an existing conversation with `--resume <sessionId>` instead of `--session-id`.
`--fork-session` resumes into a *new* session id — that is how "branch this chat" would
work if we ever add it.

Output is NDJSON on stdout: one JSON object per line. Never assume a line is complete
before a `\n` — buffer partial lines.

### Event families (verified)

| `type` | Meaning | Key fields |
|---|---|---|
| `system` / `init` | session handshake, first line | `cwd`, `session_id`, `model`, `permissionMode`, `tools[]`, `slash_commands[]`, `skills`, `claude_code_version` |
| `system` / `status` | coarse lifecycle | `status` (e.g. `requesting`) |
| `system` / `hook_started`, `hook_response` | user hooks firing | `hook_name`, `output`, `stdout`, `stderr`, `exit_code`, `outcome` |
| `stream_event` | raw Anthropic streaming events, wrapped | `event`, `parent_tool_use_id`, `ttft_ms` |
| `assistant` | one complete assistant message per turn | `message.content[]`, `request_id` |
| `user` | tool results being fed back | `message.content[]` (`tool_result` blocks), `tool_use_result` |
| `rate_limit_event` | quota state | `rate_limit_info.{status, resetsAt, rateLimitType, overageStatus}` |
| `result` / `success` \| error subtypes | terminal summary, last line | `is_error`, `result`, `num_turns`, `duration_ms`, `total_cost_usd`, `usage`, `permission_denials[]`, `stop_reason` |

Inside `stream_event`, `event.type` is the standard Anthropic set:

- `message_start` — new assistant message; carries `message.model`, `usage`
- `content_block_start` — `content_block` is `{type:"text"}` or
  `{type:"tool_use", id, name, input:{}}`
- `content_block_delta` — `delta` is `{type:"text_delta", text}` for prose or
  `{type:"input_json_delta", partial_json}` while a tool's arguments stream in
- `content_block_stop`, `message_delta` (`stop_reason`, `usage`), `message_stop`

`parent_tool_use_id` is non-null when the output comes from a subagent — use it to nest
or hide, never to drop silently.

### Mapping to UI events (SSE)

The server translates the above into a small, stable event set. The browser must never
see raw `stream_event` objects — keeping the translation server-side means a CLI format
change touches one file.

| SSE event | Payload | Rendered as |
|---|---|---|
| `session` | `{sessionId, model, cwd, permissionMode, tools}` | chat header |
| `text` | `{delta}` | streamed prose (batched — see below) |
| `tool_start` | `{id, name, input}` | new collapsed tool card |
| `tool_input_delta` | `{id, partialJson}` | optional: "…" on the card while args stream |
| `tool_result` | `{id, content, isError}` | card body: diff, stdout, or error state |
| `turn_end` | `{stopReason, usage}` | thinking indicator off |
| `rate_limit` | `{status, resetsAt, rateLimitType}` | quota chip in the status bar |
| `done` | `{isError, result, numTurns, durationMs, costUsd, denials}` | run summary line |
| `error` | `{message, stderr}` | danger banner + toast, stderr verbatim |

**Text batching contract:** the server may coalesce consecutive `text_delta`s into one
`text` event (~50ms window). The client additionally buffers into a
`requestAnimationFrame` flush. Both layers matter — one keeps the wire quiet, the other
keeps React sane.

### Tool card content, per tool

`tool_result.content` is a string. Render by `name`:

| Tool | Card shows |
|---|---|
| `Edit`, `Write`, `NotebookEdit` | file path + the diff for that file (from `git diff -- <path>`, not from the tool text) |
| `Read` | path + line range, collapsed by default |
| `Bash` | the command as a mono one-liner, stdout/stderr in a scrollable pre |
| `Glob`, `Grep` | pattern + match count, list on expand |
| `Task` | subagent label; nest its events by `parent_tool_use_id` |
| anything else | name + pretty-printed JSON input, raw text result |

### Permission modes — what actually works headless

`--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`, `manual`,
`dontAsk`, `plan`.

**Important:** this CLI version exposes no `--permission-prompt-tool`, so there is no
documented channel to answer an interactive approval from our UI in `-p` mode. Treat
`manual` as unavailable in v1 rather than shipping a dropdown option that hangs.

Supported in v1: **`acceptEdits`** (default), **`plan`** (read-only — good for "what
would you change?"), **`bypassPermissions`** (explicit opt-in, warn banner while active).

If real in-UI approval cards become a requirement, that is the reason to revisit the
**Claude Agent SDK**, which exposes a `canUseTool` callback for exactly this — and at
that point verify whether it authenticates with the subscription or bills by API key.

### Cost and usage

`result.total_cost_usd` is present per run (the sample run reported `0.457`). On a
subscription you are **not** billed that amount — it is the notional API-equivalent
cost. Useful as a *relative* signal ("this chat is expensive") and for the usage chip;
never present it as money charged.

`rate_limit_event` is the honest quota signal: `rateLimitType` (e.g. `five_hour`),
`status`, and `resetsAt` (unix seconds). Surface it — knowing a five-hour window resets
at 14:30 is exactly what you want before starting a big task.

---

## 2. HTTP routes

All JSON. All errors follow one shape so the client has a single error path:

```jsonc
{ "error": { "message": "human sentence", "detail": "raw stderr, verbatim", "code": "GIT_DIRTY" } }
```

### Projects

| Route | Body / Query | Returns |
|---|---|---|
| `GET /api/projects` | — | `Project[]` |
| `POST /api/projects` | `{path, name?}` | `Project` — 400 if not absolute, missing, or not a git repo |
| `PATCH /api/projects/:id` | `{name?, defaultPermissionMode?, verifyCommand?}` | `Project` |
| `DELETE /api/projects/:id` | — | `{ok:true}` — list entry only, folder untouched |
| `GET /api/fs/browse` | `?dir=` | `{dir, parent, entries:[{name, path, isDir, isRepo}]}` |
| `POST /api/attachments` | `{name, dataBase64}` | writes to `~/.flightdeck/attachments/<date>/` and returns `{name, path, sizeBytes, kind}`. Names are sanitised; 5 MB cap (base64 must fit the 8 MB body limit) |

`GET /api/fs/browse` with no `dir` starts at `state.lastBrowsedDir`, falling back to the
user's home directory. There is no default projects root — see DECISIONS.md.

### Chats

| Route | Body / Query | Returns |
|---|---|---|
| `GET /api/chats` | `?projectId=` | `Chat[]` (includes sub-chats; client nests by `parentChatId`) |
| `POST /api/chats` | `{projectId, title?, parentChatId?, permissionMode?}` | `Chat` with a fresh `sessionId` UUID |
| `PATCH /api/chats/:id` | `{title?, permissionMode?}` | `Chat` |
| `DELETE /api/chats/:id` | — | `{ok:true}` — kills the process if running |
| `GET /api/chats/:id/history` | — | `UiEvent[]` replayed from `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Empty when there is no transcript — never an error |
| `POST /api/chats/:id/message` | `{text}` | **SSE stream** of the events in §1 |
| `POST /api/chats/:id/abort` | — | `{ok:true}` — SIGTERM the child, then SIGKILL after 2s |
| `GET /api/chats/running` | — | `{[projectId]: chatId}` for the sidebar indicators |
| `GET /api/sessions/discoverable` | `?projectId=` | transcripts on disk no chat points at: `{sessionId, firstPrompt, sizeBytes, modifiedAt, active}` |
| `POST /api/sessions/import` | `{projectId, sessionId, title?}` | adopts an existing session as a chat; `lastMessageAt` is set from the file so the next message resumes rather than claiming the id |

### Git — every route resolves the path from `projectId`, never from the client

| Route | Body / Query | Notes |
|---|---|---|
| `GET /api/git/status` | `?projectId=` | `{branch, ahead, behind, staged[], unstaged[], untracked[]}` |
| `GET /api/git/diff` | `?projectId=&file=&staged=` | unified diff text for one file |
| `POST /api/git/stage` | `{projectId, files[]}` | returns `{status, skipped[]}` — a nested git repo cannot be added, and one such path must not fail the batch |
| `POST /api/git/unstage` | `{projectId, files[]}` | `restore --staged`, so the working tree is never touched |
| `POST /api/git/discard` | `{projectId, files[]}` | destructive — client must confirm by name |
| `POST /api/git/commit` | `{projectId, message, files?}` | `files` omitted = commit staged |
| `POST /api/git/commit-message` | `{projectId, model?}` | drafts a message from the staged diff via a one-shot `claude -p`; `NOTHING_STAGED` when the index is empty. Returns `{message, truncated, costUsd, model}` |
| `POST /api/git/stash` | `{projectId, message?, includeUntracked?}` | |
| `POST /api/git/stash-pop` | `{projectId, index?}` | |
| `GET /api/git/stash-list` | `?projectId=` | |
| `POST /api/git/fetch` | `{projectId}` | `--prune`; returns git's summary + fresh status |
| `POST /api/git/pull` | `{projectId}` | `--ff-only`; refuses on a dirty tree (`GIT_DIRTY`) or no upstream (`NO_UPSTREAM`) |
| `POST /api/git/push` | `{projectId}` | current branch to its own remote; sets upstream on first push; **never** `--force`. Remote/branch are read from config, never from the request |
| `GET /api/git/branches` | `?projectId=` | `{current, local[{name,current,upstream,subject,when}], remote[]}` |
| `POST /api/git/branch` | `{projectId, branch, from?}` | create and switch; carries the working tree on purpose; validates the name (`BAD_BRANCH_NAME`) |
| `DELETE /api/git/branch/:branch` | `?projectId=&force=` | `-d` by default (`UNMERGED` when commits exist nowhere else); refuses the checked-out branch (`CURRENT_BRANCH`) |
| `GET /api/git/log` | `?projectId=&limit=50` | `{hash, subject, author, date}[]` |
| `POST /api/git/checkout` | `{projectId, branch}` | **refuse** with `GIT_DIRTY` when the tree is dirty |
| `GET /api/git/identity` | `?projectId=` | `{current:{name,email,scope}, saved[]}` — `scope` is `local` \| `global` \| `none` |
| `POST /api/git/identity` | `{projectId, name, email, save?, label?}` | writes `git config --local` only; never touches global |
| `DELETE /api/identities/:id` | — | forgets a saved identity; changes no repository's config |

Never `push`. Never `reset --hard`. Not in v1, and probably not ever — the point of the
tool is that the risky half stays in your hands.

### Terminal (Phase 3)

`GET /api/terminal/shells` → `{profiles: ShellProfile[], defaultId}`

Detected, never assumed: PowerShell 7 (PATH or `Program Files/PowerShell/7`), Windows PowerShell
(`%SystemRoot%`), `COMSPEC`, Git Bash (derived from `git` on PATH — `<gitRoot>/bin/bash.exe`), and one
entry per WSL distro. Elsewhere: `$SHELL`, then zsh/bash/fish/sh where they exist. Anything that
fails its `existsSync` probe is simply not offered, so the picker can never list a shell that will not
start.

`wsl --list --quiet` writes **UTF-16LE**. Decoded as UTF-8 it yields NUL-interleaved names that pass a
"returns strings" check and then fail to launch, so the decode is pinned by a test.

`POST /api/terminal/:projectId/stop` → `{stopped: boolean}`

Kills a project's shell without being attached to it. The socket's `stop` message only reaches a shell whose
panel is open, and shells now outlive their panel — without this, killing a dev server in a project you are
not in means switching to it first. Idempotent: a project with no shell returns `{stopped: false}` rather
than a 404, because that is the state the caller asked for. Used by the deck.

`WS /ws/terminal?projectId=<id>&shell=<profileId>`

| Direction | Message |
|---|---|
| client → server | `{type:"input", data:"ls
"}` |
| client → server | `{type:"resize", cols, rows}` |
| client → server | `{type:"stop"}` — kill the shell; the only in-socket path that does |
| server → client | `{type:"ready", shell, shellId, cwd, scrollback, restored}` — first message, before any output |
| server → client | `{type:"output", data:"..."}` |
| server → client | `{type:"exit", code}` — the shell ended; the server closes the socket after it |
| server → client | `{type:"error", message, detail?}` — could not start; the socket closes |

One PTY per project, `cwd` = the project path. The shell is `?shell=` if it resolves, else
`settings.terminalShell`, else the first detected profile (`FLIGHTDECK_SHELL` overrides all of them).
An **unknown id falls back to the default rather than erroring** — a profile disappears when a shell is
uninstalled, and a stale setting must not cost you a terminal. `ready` echoes `shellId` so the picker
shows what actually started, not what was asked for.

Switching profiles opens a new socket; the program behind a PTY is fixed at spawn.

Verified on Windows by opening a socket per detected profile and running a command: PowerShell, cmd
and Git Bash all ran. WSL reported `ready` and the distro then failed to mount
(`Wsl/Service/CreateInstance/MountDisk/HCS/E_ACCESSDENIED`) — an environment problem on that machine,
surfaced verbatim in the terminal with exit code -1, which is the correct behaviour: detection can see
that WSL is installed, not that it will start.

**Sessions are keyed by project and outlive their socket.** `close` and `error` call `detach`, which stops forwarding
output and leaves the shell running; only an explicit `{type:"stop"}` and shutdown dispose. This reverses an earlier
decision — see DECISIONS.md — because switching projects remounts the terminal, and killing the shell there took down
whatever dev server had just been started.

Reattaching replays the session's recent output (half a megabyte, trimmed from the front) as an ordinary `output`
message, and `ready` carries `restored: true` so the UI can say the shell was already running. A second client
attaching takes over rather than sharing, since two windows writing into one PTY interleave keystrokes.

Choosing a different shell profile restarts the session rather than reusing it.

Verified against the reported bug: a ticker in project A went from 1 to 12 ticks while a socket for project B opened
and closed, reattached with `restored: true`, and B's output never reached A. `disposeAll` on shutdown is unchanged and
covered by a test.

`POST /api/git/stash-drop` `{projectId, index, expectSubject}` -> `GitStatus`

Deletes a stash without applying it. **The one unrecoverable action in the git routes** — the reflog keeps the
commit for a while but nothing in this UI can reach it.

`stash drop` takes a position, and dropping one renumbers everything after it, so an index alone can name a
different stash than the one the user clicked. The caller therefore sends the subject the row displayed, and the
route re-reads the list and refuses on a mismatch: `STASH_MOVED` with what that position actually holds now, or
`STASH_GONE` when the index is past the end. Verified against three real stashes — after dropping index 1, a
repeat request for index 1 with the old subject was refused and nothing was dropped.

The UI always confirms this one, regardless of the confirmation-level setting, and names the stash rather than a
count.

`POST /api/git/merge-ff` `{projectId, ref}` -> `{summary, status, branches}`

`git merge --ff-only <ref>` and nothing else, for the case where a pull request lands on the host and the trunk
needs to catch up before being pushed.

The old rule was that no merge belongs in this tool. It was about the dangerous half of merging — a merge commit
invented for you, a conflict to resolve, history rewritten. `--ff-only` does none of those: the pointer moves to a
commit that already contains yours, or the command refuses. `--no-ff`, `--squash`, `-X` and strategy options are
unreachable, asserted by a test.

Refusals, each verified against a real remote and two clones: `GIT_DIRTY` (checked before git is asked, so the
message is about what to do), `SAME_BRANCH`, `NO_SUCH_REF` (the ref is verified as a commit first, and goes through
the same shape check as a branch name, which rejects a leading dash), and `NOT_FF` carrying git's own
"Diverging branches can't be fast-forwarded" with `HEAD` confirmed unmoved.

**Nothing is pushed.** That stays a separate act.

`GET /api/git/branches` now also returns `defaultBranch`, from `origin/HEAD` where it is set, falling back to a
conventional name only if that branch exists and to null rather than guessing. The UI uses it to warn when a
fast-forward is about to happen somewhere other than the trunk.


### Commit history

`GET /api/git/log?projectId=&limit=&skip=` → `{commits, hasMore}`
`GET /api/git/commit?projectId=&sha=` → `CommitDetail`
`GET /api/git/commit-diff?projectId=&sha=&path=` → `{diff}`

Read-only, with no route that could become a revert or a reset. Looking back at a commit is a different act
from undoing it, and the second belongs in a terminal.

**Every client value is shape-checked before it becomes a git argument.** A sha must match
`/^[0-9a-f]{4,40}$/` — which rejects `HEAD`, `main`, `--upload-pack=evil` and anything carrying a shell
character — and a file path is passed after `--`, so a file called `--output=x` is a path and not a flag.

Paging asks for `limit + 1` rows and reports `hasMore` from the overflow, so a 40,000-commit repository never
pays for a count. `skip` rather than a cursor: git counts from HEAD, so a commit made mid-scroll shifts the
window by one, which shows a row twice rather than losing one — and the client de-duplicates by sha.

Parsing quirks, each verified against real git output in `test/history.test.ts`:

- `%D` prints `HEAD -> main, tag: v1`; splitting on the comma first collapses `HEAD -> main` to one `main` chip.
- A rename arrives as `dir/{old => new}.ts` with the shared prefix factored out, which a naive split on ` => `
  gets wrong.
- A binary file reports `-` where a count belongs, so `Number(x) || 0` and not `Number(x)`. NaN would render
  as "NaN".
- `--numstat` gives counts but no status letter; `--name-status` supplies it.
- An empty repository makes `git log` fail; that is "no commits yet", not an error.
- The commit body is fetched as its own `--format=%b` call, because a message can contain the separator the
  format string uses.

### Project scripts

`GET /api/scripts?projectId=` -> `{manager, scripts: [{name, command, run}], suggested}`

Read from `package.json` on every request, so a script added while the server runs is picked up. The package manager
comes from the lockfile — `pnpm-lock.yaml`, `bun.lock`, `yarn.lock`, else npm — checked most-specific first, because a
repository mid-migration often still carries a stale `package-lock.json`. `run` is already spelled for that manager,
and only yarn omits the word `run`.

`suggested` is the first of `dev`, `start`, `develop`, `serve` that exists: a project with both `dev` and `start`
means `dev` for local work, since `start` is usually the production entry point.

Nothing here executes anything. **The command is typed into the terminal**, which is the design rather than a
shortcut: a dev server prints continuously, is stopped with `Ctrl+C` and should die with its shell, so scrollback,
colour and signals all behave exactly as they do when typed by hand. That is the opposite trade-off from the build
trigger, which runs server-side precisely to avoid a shell — there the command is fixed and its result is a git
state; here it is a long-running process whose log is the point.

A missing, unreadable or malformed `package.json` returns an empty list rather than an error: plenty of repositories
are not Node projects, and the button simply does not appear.


### Slash commands

`GET /api/commands?projectId=` → `{commands: SlashCommand[]}`

Commands from `.claude/commands/**/*.md` and skills from `.claude/skills/*/SKILL.md`, project level then user
level, project winning a name clash. Subdirectories namespace with a colon (`/git:sync`), which is the CLI's own
convention. Frontmatter supplies `description` and `argument-hint`; a file without frontmatter still works and
is described by its first non-heading line.

**Verified that the CLI runs them headless before any of this was built**: a command containing "reply with
exactly SLASHWORKS" returned `SLASHWORKS` through `claude -p`, and again through Flight Deck's own stream.

One trap worth recording: `claude -p "/hello"` typed at a Git Bash prompt has the argument path-translated to
`D:/tools/Git/hello` before the CLI sees it, which made the first attempt look like slash commands did not work
headless at all. Flight Deck sends prompts as JSON on stdin, so it is immune — but testing this from bash needs
`MSYS_NO_PATHCONV=1`.

### Updates

`GET /api/update` -> `UpdateStatus` (local only, no network)
`POST /api/update/check` -> `UpdateStatus` (fetches first)
`POST /api/update/apply` -> `{message, detail, status}`, or 400 with `{error, status}`

Whether this copy is behind **its own remote**, asked of git rather than of a web API. The alternative needs a
hardcoded repository — which makes a fork check the wrong one — plus a token, a rate-limit story, and a
third-party request from an app that claims to make none of its own. The install is already a clone with a
remote, so `@{u}` is the honest question.

States: `up-to-date`, `behind`, `ahead`, `diverged`, `no-upstream`, `not-a-repo`, `error`. Each is a state, not
a failure: a copy downloaded as a zip reports `not-a-repo` rather than erroring, and a branch tracking nothing
says so.

`incoming` carries the actual commits (sha, subject, author, date, newest first, capped at 20) because a bare
count does not tell anyone whether to bother. `lastFetchedAt` comes from the mtime of `.git/FETCH_HEAD`, so it
survives a restart.

**Apply is `git merge --ff-only` and nothing else.** It refuses a dirty tree (the person most likely to press it
is someone editing Flight Deck itself), refuses a diverged fork rather than merging, and never resets, rebases
or stashes. Dependencies are not installed and the server is not restarted — both would kill the process serving
the request — so the response says to do it.

The client reads locally on every launch and only fetches when the last fetch was over six hours ago, or when
the user presses Check now. With `settings.checkForUpdates` off, the route refuses too, so the setting means what
it says.

Verified against real repositories in `test/update.test.ts`: a bare remote plus two clones covering behind,
ahead, diverged, no-upstream, not-a-repo, dirty, a successful fast-forward, and both refusals leaving `HEAD`
untouched. On this machine the real fetch against `origin` took ~1s.

### Attachments and tool access

Attachments are written to `~/.flightdeck/attachments/<day>/`, and the *path* is appended to the prompt —
so the agent reads what it needs with its own Read tool and a 2 MB screenshot never becomes 2 MB of
context.

That directory is outside every repository, which means outside the session's working directory, and the
CLI **refuses tool access there**. Without a grant, a pasted image produced:

```
Claude requested permissions to read from
C:/Users/.../.flightdeck/attachments/2026-08-19/b6001736-image.png,
but you haven't granted it yet.
```

and the run could not see the file. There is no approval channel to answer that request through (no
`--permission-prompt-tool`), so every run now passes `--add-dir <attachmentsDir>`. One directory, one that
Flight Deck owns; it grants nothing over the user's own files. Passed on resumed sessions too, since a chat
can refer back to a file attached several turns earlier.

Verified end to end: an 8x8 magenta PNG was uploaded, its path sent in a prompt, and the run's `Read`
returned `isError=false` with the image as base64 — the model answered "Magenta."

`GET /api/usage/transcripts` -> `{projects: ProjectTranscriptUsage[]}`

Usage read out of Claude Code's own transcripts, so a conversation held in a terminal or an editor counts
too. Sessions are located by the CLI's encoding of the cwd, so anything that ran in a project's folder is
found whoever started it.

**What a transcript contains, checked against a real 15 MB file:** every assistant entry carries
`message.usage` in **snake_case** (`cache_read_input_tokens`), and the model on `message.model`. What it does
NOT contain is any `result` record — `total_cost_usd` is written to stdout by `-p` and never to the file. So
these sessions report tokens and **no cost**, and are kept out of the cost totals rather than priced by
guesswork. A session that changed model mid-way is reported under whichever model wrote most of its messages.

Lines are prefiltered on the substring `"usage"` before `JSON.parse`; on that 15 MB transcript the read took
42ms and the scan 38ms, against 175ms for all 17 sessions of the busiest project. A half-written final line
is normal in a live transcript and is skipped.

`adoptedSessionIds` marks the sessions that are already chats in Flight Deck, so this list and the run list
reconcile instead of looking like double counting.

### Usage (per-project cost and quota)

`GET /api/usage?days=1|7|30|90|0` → `UsageReport` (0 means everything recorded)

Aggregated from `~/.flightdeck/usage.jsonl`, one line appended per finished run. A separate file rather
than `state.json` because that document is rewritten atomically on every change — appending thousands of
records to it would mean rewriting the whole thing to add 300 bytes. Every line is validated on read: the
writer can be killed mid-write, so a truncated last line is normal and costs one line, not the file.

**Two traps in the CLI's `result` record, both verified against a real run.** There is no top-level
`model` field — the model is a KEY of `modelUsage` (`claude-opus-5[1m]`, with a context-window suffix),
so `canonicalModel` inside the entry is preferred. And token counts appear under `usage` in snake_case
(`cache_read_input_tokens`) while `modelUsage` carries the same numbers in camelCase. Reading the wrong
casing yields a confident zero rather than an error.

The four token counts are stored and shown **separately, never summed**: a typical run reads tens of
thousands of cached tokens and writes a few hundred, so a single "tokens" figure means nothing. Measured
on a real Haiku run: 10 in, 49 out, 0 cache read, 28,581 cache creation.

`costUsd` is what the same tokens would have cost through the API. A subscription is not billed per
token, so it is labelled **notional** everywhere it appears — honest for comparing projects, not a bill.
Totals are rounded on the way out, because summing real CLI costs produces `0.45736200000000005`.

The quota window is bounded by the CLI's own `resetsAt` (persisted to `state.lastRateLimit`, since the
CLI only mentions it mid-run), falling back to the last five hours — and the UI says which it used. The
window is computed independently of the selected period, so looking at 90 days does not widen "this
window" to 90 days.

A run whose project has since been removed keeps its history, labelled `(removed)`: the quota was still
spent, and dropping the row would make the totals disagree with the rows.

`GET /api/usage/project?projectId=<id>&days=<range>` → `ProjectUsageReport`

One project opened up: its own totals, model split and daily figures, plus **every individual run** —
timestamp, chat, model, turns, duration, output and cache tokens, cost, error flag — newest first. Also
that project's chats ranked by cost, so an expensive conversation is findable rather than merely
suspected.

Capped at 250 rows, and the count of older runs is returned so the table can say what it left out; the
totals still cover everything. A deleted chat's runs are labelled `Deleted chat` rather than shown blank.
`aggregateProject` shares the same `add`/`round` helpers as the cross-project report, so a detail page can
never disagree with the row that led to it — asserted by a test that compares the two.

Verified with three real Haiku runs across two projects: cross-project attribution came out flightdeck
84% / prototype 16%, the drill-down listed all three runs newest-first with per-run tokens and cost, and a
chat deleted earlier appeared as `Deleted chat` with its cost intact.

### External tools

`GET /api/tools` → `{tools: ToolStatus[], checkedAt}` · `?refresh=1` re-probes instead of using the cache.

What this machine has that Flight Deck does not ship. One entry today: `gh`, needed for pull requests and
nothing else.

**Asked at the point of use, never at install time.** There is no `postinstall` hook and a test asserts there
never will be: `npm install` runs non-interactively under `npm ci`, in CI and in Docker, so a prompt there
hangs a build with no explanation. Nothing here installs anything either — the response carries the official
install command *for this machine*, and the UI types it into the user's own terminal where it can be read and
stopped.

Three states, not two. `installed: false` → `authenticated: null`, because claiming "not signed in" about a
tool that is not there sends the user to the wrong instruction. `installed: true, authenticated: false` is a
`gh auth login` away, and it fails as a permission error mid-request rather than as a missing command.

`installCommand` is per operating system, and only ever a command whose package manager actually answered.
`installManager` names which one, since the same tool is spelled differently everywhere:

| OS | Probed in order | Command for `gh` |
|---|---|---|
| Windows | winget, choco, scoop | `winget install --id GitHub.cli --source winget` · `choco install gh` · `scoop install gh` |
| macOS | brew, port | `brew install gh` · `sudo port install gh` |
| Linux | dnf, pacman, zypper, apk, brew | `sudo dnf install gh` · `sudo pacman -S github-cli` · `sudo zypper install gh` · `sudo apk add github-cli` · `brew install gh` |
| anything else | — | none; `docsUrl` only |

Per OS rather than one global list, and that is a bug fix: a single list let a Windows machine carrying MSYS2's
`pacman` be handed `sudo pacman -S github-cli` — no `sudo` to run it, and a package set without that package.
Being *present* is not being *appropriate*. Native managers sit above Homebrew on Linux because their updates
arrive with the system's, and `brew` never carries `sudo` (it installs into its own prefix and refuses).

Probed in order and short-circuited, so the usual cost is one spawn. `apt` is deliberately absent: the official
Debian/Ubuntu route adds a keyring and an apt source first, and a privileged three-command sequence typed by a
button is not something to accept on trust. Those machines get `docsUrl`.

**Detection spawns the command; it does not stat `PATH`.** `winget` lives at
`%LOCALAPPDATA%/Microsoft/WindowsApps/winget.exe`, an app execution alias — a zero-length reparse point that
`stat` cannot resolve. Measured here: `existsSync` false, `statSync` ENOENT, `execFile('winget',
['--version'])` prints a version. Anything Store-installed has that shape, so a filesystem probe silently
under-reports. ENOENT means "no such command"; any other non-zero exit means the tool ran and said something,
which is a state to report rather than a failure to hide.

Cached, because `gh auth status` is a network round trip. Refreshable, because whoever pressed "check again"
has just installed something — and on Windows the answer after that is often still "not found", since a
running process keeps the PATH it started with. The UI says so in those words rather than leaving it to be
discovered.

`POST /api/tools/gh/login` · body `{token}` → the re-probed `{tools, checkedAt}`, or **400** with gh's own words.

Signing in by pasting a personal access token, and the **primary** path rather than a fallback. Driving
`gh auth login`'s device-code flow through the embedded terminal proved unreliable in a way better presentation
cannot fix: the one-time code has to be copied out of a terminal where `Ctrl+C` is SIGINT, the CLI has to stay
alive across a browser round trip it does not own, and an interrupted attempt is indistinguishable from a
rejected one — authorise a moment after the CLI has died and nothing happens, with nothing to say why.

The token goes to `gh auth login --with-token` on **stdin**, never argv, which is visible to anything that can
list processes. gh stores it in the system credential store. Flight Deck never writes it to `state.json`, never
logs it, and never sends it back: success returns the re-probed status, and failure returns gh's `detail` (a
real 401 reads as `error validating token: HTTP 401: Bad credentials`). `tokenUrl` on the status is GitHub's
token page with gh's stated minimum scopes — `repo`, `read:org`, `gist` — already selected.

Validated before gh sees it: a single line, no whitespace, under 512 characters. A pasted-wrong token otherwise
comes back as a confusing error about a token that was never sent.

### Review a branch

`GET /api/projects/:id/review` → `{context, last}` · `DELETE` forgets the last one.

`context` says what there is to review before anything is spent finding out: the branch, the base, the merge
base, commits ahead, changed files, uncommitted count, and the untracked files that no diff against a commit
contains. `reason` is set when there is nothing to do — clean tree, no base branch, unrelated histories — and
the button is then refused rather than spending a run to be told nothing.

The base is the project's remembered fast-forward ref first (`origin/dev` here, which no default-branch guess
would produce), then `origin/HEAD`, then the usual trunk names, and only refs that exist. Measured against the
**merge base**: comparing against the tip of the base would attribute every commit it has gained since you
branched to you.

`POST /api/projects/:id/review` → SSE: the agent's own `UiEvent`s, then exactly one
`{type:"review", review}`.

One ordinary agent run — same spawn, same events, same usage accounting — with three differences. The chat is
**ephemeral** (a review is not a conversation; twenty in the sidebar would bury the chats). It runs in
**`plan` mode**, so the reviewer cannot edit the tree it is judging, which is a guarantee from the CLI rather
than a line in a prompt. And its final message is parsed into findings.

**The diff is not pasted into the prompt.** The agent is given the base sha and runs `git diff` itself: less
context than a pasted diff, and it can read whole files around anything it is unsure about. A reviewer that
cannot see the caller of a changed function is guessing.

Findings come back as one fenced JSON block — `{file, line, severity, title, detail}` — and `parseReview` is
deliberately tolerant: the **last** block wins (a reply often echoes the example first), a nonsense severity
becomes `medium`, a non-line becomes `null`, backslash paths are normalised, and a finding with no file or no
title is dropped. A reply it cannot read sets `parsed: false` and keeps `raw`, because an empty findings list
renders as "nothing to raise" — the one wrong answer this feature can give.

Measured on real runs: this repository's own uncommitted change (12 files, 9 untracked) took **28 turns, 17
file reads, $2.58** and produced 10 findings; a one-file project took **4 turns, $0.22** and produced 1.

### Open pull requests

`GET /api/pulls` → `{projects: ProjectPulls[]}` — every project, which is what the page uses.
`GET /api/projects/:id/pulls` → `{repo, pulls, code, reason}` — one project.

Across all projects rather than the selected one: "which of my repositories have something waiting?" is the
same question the deck answers for uncommitted work, and it is the one an editor cannot answer at all. Scoping
it to the selection hid three pull requests in another repository until you clicked into it. Bounded at four
concurrent requests — these are network round trips, not local spawns — and one repository failing costs that
repository its rows and nothing else.

**Nothing is filtered by target branch.** Only `--state open`; every pull request appears whatever it aims at,
and `head → base` is on every row so that one aiming somewhere unusual is visible rather than assumed. A test
pins the absence of `--base`, because adding one later would silently hide work.

The repository is read from the project's own `origin` and parsed into `{host, owner, repo, isGitHub}` —
`parseRemote` handles https, scp-like `git@host:owner/repo`, `ssh://`, credentials in front, a port, a missing
`.git`, and a self-hosted install serving from a sub-path. Never a list of every repository the account can
see: the imported projects are the unit of work, and a repository with no local clone has no diff to review.

Then one read-only `gh pr list -R owner/repo --state open --limit 50 --json …`. `code` carries the state:

| code | what it means |
|---|---|
| `OK` | `pulls` is the answer, possibly empty |
| `NO_REMOTE` / `NOT_GITHUB` | no `origin`, or a host `gh` cannot read — branch review still works, and the page says so |
| `NO_ACCESS` | GitHub said `Could not resolve to a Repository` |
| `NOT_SIGNED_IN` / `OFFLINE` / `FAILED` | gh's own words, verbatim |

**`NO_ACCESS` is deliberately ambiguous and the message says so.** GitHub answers identically for "does not
exist" and "you cannot see it", so that private repositories cannot be enumerated by watching error codes.
Claiming either one would tell someone their repository does not exist while they are looking at it in another
tab.

`probe` takes a 16 MB `maxBuffer` for this: fifty pull requests of JSON exceeds the default 1 MB pipe, and
exceeding it kills the child with ENOBUFS rather than truncating — which would have read as "GitHub returned
nothing".

Measured live on this machine's own repositories: 3 open on one, 1 on another, 0 on a third, and a
cross-account repository read fine with the other account's token.

### Review a pull request

`GET /api/projects/:id/pulls/:number` → `{pull, diff, files, body, reason, last}` — two `gh` calls, `view` for
the facts and `diff` for the patch. The diff is text and goes straight into the existing `DiffView`, so
word-level highlighting comes for free.

`POST /api/projects/:id/pulls/:number/review` → the same SSE stream as a branch review, ending in one
`{type:"review", review}` with `pull` set.

**The commit is fetched first, and nothing is checked out.**
`git fetch origin --force pull/N/head:refs/flightdeck/pr-N` — a ref in a namespace this tool owns. No branch
switch, no working-tree change; the human decides what the tree contains. Verified on a real pull request
before any of it was built: the ref appeared, `git diff` against the merge base matched GitHub's own +183/−15,
and `git status` on the checked-out branch was unchanged.

The ref matters because the reviewer then reads whole files at the pull request's revision with
`git show <ref>:<path>` — your copy of a file it changed is a different file, and reviewing against the wrong
one produces confident nonsense. Forced, so a pull request that gains commits reuses its ref rather than
accumulating one per fetch.

Reviews are remembered per subject: `<projectId>` for a branch, `<projectId>:pr:<number>` for a pull request.
In memory only.

Measured on a real pull request (7 files, +183/−15): **12 turns, $0.81, 4 findings** — and **zero `Read`
calls**, because at a ref the agent reads with `git show` instead. That is why progress counts commands as well
as file reads; a single "files read" counter honestly showed 0 while it worked.

### Where transcripts live

`~/.claude/projects/<encoded cwd>/<sessionId>.jsonl`, where the encoding replaces **every character that is not
a letter or a digit** with a dash — separators, underscores, dots and spaces alike. `C:` then a path of `repos` and `my_app`
becomes `C--repos-my-app`: three characters, three dashes, nothing collapsed.

Read by history replay, the session-import dialog and per-project usage. All three go through
`resolveTranscriptDir` / `findTranscript`, and a test asserts none of them computes the path itself — one wrong
directory name broke all three at once, and each looked like a separate bug.

Two fallbacks, because this format is observed rather than documented:

- **Case.** The CLI records `E--…` or `e--…` depending on how the shell spelled the drive letter. Windows
  resolves either; a case-sensitive filesystem does not, so a miss retries case-insensitively.
- **Anything else.** `findTranscript` scans the project directories for `<sessionId>.jsonl`. A session id is
  ours and unique, so the file is the transcript wherever it was filed. One readdir on a miss, nothing in the
  common case.

### Deck (cross-project overview)

`GET /api/overview` → `{projects: ProjectOverview[], readAt}`

Every project in one response: branch, tracking, ahead/behind, staged/unstaged/untracked counts, HEAD's
subject and date, when an agent last ran there, `dirtySince`, and `shellRunning`.

`shellRunning` comes from the PTY table, not from git. Shells outlive the panel that opened them, so a dev
server can be alive in a project you have not opened today, and this is the only place that is visible
across every project at once. Read in the same response rather than a second request — a badge one refresh
behind is worse than none. Stopping one is `POST /api/terminal/:projectId/stop`, in the Terminal section above.

`dirtySince` is the mtime of the **oldest** changed file, not the newest. Newest tells you when you last
saved, which you already know; oldest tells you this repository has had work sitting in it since
Tuesday, which is the thing you forget. Capped at 200 files statted — it is a hint, not an audit.

Read with a bounded pool (6 at a time, 5s per git call) because each repository costs two spawns and
spawning is the expensive part on Windows. A repository that cannot be read gets `error` on its own card
rather than failing the response, and a folder that has moved gets `missing: true` — silently rendering
it as "clean" would be the worst outcome.

No agent, no tokens: git and the filesystem.

`POST /api/overview/fetch` → `{fetched, failed}`

Fetches every project, then the deck is re-read. Its own action rather than automatic: ahead/behind is
measured against local remote refs, so on a deck that has not fetched today every card honestly reads
0/0 — which looks like "nothing to push". Read-only on each remote, so no confirmation. Unreachable
remotes are counted, not thrown.

Measured on the author's four registered repositories: overview in **219ms**, fetch-all across four real
remotes in **2.1s**, 0 failures.

### Build trigger

`POST /api/git/trigger-build` → `{summary, status}`

An empty commit, then a push — for pipelines that only run on a new commit. Human-initiated from the
terminal header, always behind a confirmation that shows both commands verbatim.

**A staged index is refused** with `GIT_STAGED` and the file list. `git commit --allow-empty` does not
mean "commit nothing": it commits whatever is in the index, so without this guard the button would
quietly ship staged work under the message `trigger build`. Unstaged and untracked files are left
alone, since an empty commit never touches the working tree.

The commit message is fixed at `trigger build`, and the push goes through the same
`pushCurrentBranch` helper as `/api/git/push` — one push implementation to audit, no force in any
spelling, remote and branch read from the repository.

If the commit succeeds and the push fails, the error says so and names the local commit, because
"could not push" alone leads to pressing the button again and stacking empty commits.

Verified against a bare upstream and a clone: a clean tree pushed `7b96569` and the commit arrived in
the upstream log; a staged `wip.txt` was refused and stayed staged; unstaged edits plus an untracked
file produced a genuinely empty commit with the working tree untouched; and with the upstream moved
away, the response read `Empty commit 1765189 was created, but the push failed` with git's own
`Could not read from remote repository` and the `git reset --hard HEAD~1` escape.

### Settings and storage

`GET /api/settings` · `PATCH /api/settings` · `POST /api/settings/reset`

Preferences live in `state.json` beside the project list, not in browser storage — the server is the
only thing that survives a reload, a second tab, or a restart, and a setting that silently differs per
tab is worse than no setting.

**Every field is validated against its allowed values**, and a model id must be one this build offers.
A free-text model would reach the CLI as `--model claude-opus-6` and fail once per run with an error
that reads like a Flight Deck bug rather than a bad setting. Ranges: terminal font 9–24, turn cap 0–200
(0 meaning no cap).

What each setting actually drives, since a preference that changes nothing is worse than a disabled one:

| Setting | Effect |
|---|---|
| `defaultModel` | `model` for chats created without one; collapses to *absent*, never `--model ""` |
| `defaultPermissionMode` | seeds `project.defaultPermissionMode` as a project is added; existing projects keep theirs |
| `maxTurns` | `--max-turns` on every run; 0 omits the flag |
| `commitSignoff` | `git commit --signoff`, so the trailer uses the identity git itself will attribute |
| `draftModel` | model for `POST /api/git/commit-message` when the request pins none |
| `terminalShell` | shell profile for new terminal sockets |
| `terminalFontSize`, `terminalCursorBlink` | mutated on the live xterm instance — **never** by recreating it, which would close the socket and kill the shell |

`GET /api/storage` → `{stateFile, attachmentsDir, attachmentCount, attachmentBytes}`

`DELETE /api/storage/attachments` → `{deleted, freedBytes}`

The directory is built from `stateDir()` server-side and never accepted from the client: that is the
entire safety of a recursive delete. It cannot reach a repository or `state.json`. Prompts that
referenced deleted files keep the paths in their text — the transcript belongs to the CLI and is not
rewritten — which the UI says before the button is pressed.

Verified over HTTP: bad model, out-of-range font size and a fractional turn cap were each rejected with
their own message; a real commit on a scratch repo produced `Signed-off-by: Dev Example
<dev@example.com>` matching the repo-local identity; and adding one 1600-byte attachment moved the
reported usage by exactly 1600 bytes. The purge route is deliberately not exercised by a test, since it
would delete the developer's own attachments — `measureAttachments` is tested against a temporary tree
instead.

