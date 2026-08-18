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

### Git — every route resolves the path from `projectId`, never from the client

| Route | Body / Query | Notes |
|---|---|---|
| `GET /api/git/status` | `?projectId=` | `{branch, ahead, behind, staged[], unstaged[], untracked[]}` |
| `GET /api/git/diff` | `?projectId=&file=&staged=` | unified diff text for one file |
| `POST /api/git/stage` | `{projectId, files[]}` | returns `{status, skipped[]}` — a nested git repo cannot be added, and one such path must not fail the batch |
| `POST /api/git/unstage` | `{projectId, files[]}` | `restore --staged`, so the working tree is never touched |
| `POST /api/git/discard` | `{projectId, files[]}` | destructive — client must confirm by name |
| `POST /api/git/commit` | `{projectId, message, files?}` | `files` omitted = commit staged |
| `POST /api/git/stash` | `{projectId, message?, includeUntracked?}` | |
| `POST /api/git/stash-pop` | `{projectId, index?}` | |
| `GET /api/git/stash-list` | `?projectId=` | |
| `POST /api/git/fetch` | `{projectId}` | `--prune`; returns git's summary + fresh status |
| `POST /api/git/pull` | `{projectId}` | `--ff-only`; refuses on a dirty tree (`GIT_DIRTY`) or no upstream (`NO_UPSTREAM`) |
| `POST /api/git/push` | `{projectId}` | current branch to its own remote; sets upstream on first push; **never** `--force`. Remote/branch are read from config, never from the request |
| `GET /api/git/branches` | `?projectId=` | `{current, local[], remote[]}` |
| `GET /api/git/log` | `?projectId=&limit=50` | `{hash, subject, author, date}[]` |
| `POST /api/git/checkout` | `{projectId, branch}` | **refuse** with `GIT_DIRTY` when the tree is dirty |
| `GET /api/git/identity` | `?projectId=` | `{current:{name,email,scope}, saved[]}` — `scope` is `local` \| `global` \| `none` |
| `POST /api/git/identity` | `{projectId, name, email, save?, label?}` | writes `git config --local` only; never touches global |
| `DELETE /api/identities/:id` | — | forgets a saved identity; changes no repository's config |

Never `push`. Never `reset --hard`. Not in v1, and probably not ever — the point of the
tool is that the risky half stays in your hands.

### Terminal (Phase 3)

`WS /ws/terminal?projectId=<id>`

| Direction | Message |
|---|---|
| client → server | `{type:"input", data:"ls\r"}` |
| client → server | `{type:"resize", cols, rows}` |
| server → client | `{type:"output", data:"..."}` |
| server → client | `{type:"exit", code}` |

One PTY per socket, `cwd` = project path, shell = `powershell.exe` on Windows. Dispose
the PTY on socket close — a refresh must not leak a process.
