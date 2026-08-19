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

`WS /ws/terminal?projectId=<id>&shell=<profileId>`

| Direction | Message |
|---|---|
| client → server | `{type:"input", data:"ls
"}` |
| client → server | `{type:"resize", cols, rows}` |
| server → client | `{type:"ready", shell, shellId, cwd, scrollback}` — first message, before any output |
| server → client | `{type:"output", data:"..."}` |
| server → client | `{type:"exit", code}` — the shell ended; the server closes the socket after it |
| server → client | `{type:"error", message, detail?}` — could not start; the socket closes |

One PTY per socket, `cwd` = the project path. The shell is `?shell=` if it resolves, else
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

**Disposal is the load-bearing part.** `close` and `error` both dispose, and shutdown walks the whole
map — a shell that outlives its socket keeps running against the repository with nobody attached.
Verified by terminating two sockets without a close handshake and confirming both shells were gone.

Reconnecting starts a **fresh** shell rather than reattaching: a PTY holds no replayable history, so
pretending to resume would present an empty screen mid-session.

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

### Slash commands

`GET /api/commands?projectId=` → `{commands: SlashCommand[]}`

Commands from `.claude/commands/**/*.md` and skills from `.claude/skills/*/SKILL.md`, project level then user
level, project winning a name clash. Subdirectories namespace with a colon (`/git:sync`), which is the CLI's own
convention. Frontmatter supplies `description` and `argument-hint`; a file without frontmatter still works and
is described by its first non-heading line.

**Verified that the CLI runs them headless before any of this was built**: a command containing "reply with
exactly SLASHWORKS" returned `SLASHWORKS` through `claude -p`, and again through Flight Deck's own stream.

One trap worth recording: `claude -p "/hello"` typed at a Git Bash prompt has the argument path-translated to
`E:/muhaz/Git/hello` before the CLI sees it, which made the first attempt look like slash commands did not work
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

### Deck (cross-project overview)

`GET /api/overview` → `{projects: ProjectOverview[], readAt}`

Every project in one response: branch, tracking, ahead/behind, staged/unstaged/untracked counts, HEAD's
subject and date, when an agent last ran there, and `dirtySince`.

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

