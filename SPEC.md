# Flight Deck

A local, single-user console for working on many projects at once: pick a project,
talk to Claude about it, review what changed, commit. One window instead of twenty
VS Code windows.

Not deployed. Not multi-user. No auth. Runs on `localhost` on one machine.

---

## Why this exists

VS Code is good at one project at a time. With ~20 repos on disk (the author keeps
them under `E:\muhaz\CStudio`; the tool assumes nothing about where yours live),
the cost is not the editing — it is the *switching*: a window per project, a chat per
window, and no memory of what the last conversation about that repo was.

Flight Deck keeps the projects, their conversations, and their diffs in one place.

**Explicit non-goal:** replacing VS Code. Editing still happens in the editor (or by
the agent). Flight Deck is a control surface — chat, review, commit.

---

## Why there is a server at all

There is no separate backend service. There is one app with two halves:

- **Browser half** — React. Renders everything.
- **Node half** — Fastify. Does the things a browser physically cannot: spawn `claude`,
  run `git`, read a project folder, open a PTY.

No database, no deploy target, no port to expose. In dev it is two processes (Vite +
Fastify); in "production" the built static files are served by Fastify itself, so
running Flight Deck is one command and a `localhost` tab.

The only alternative shape is Electron/Tauri — the same Node half wrapped in a desktop
window. That is what the previous attempt was, and its native-module rebuild pain is
exactly what this avoids.

---

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Stack | **Vite + React + Fastify**, one repo | The terminal needs WebSockets, which App Router route handlers cannot do without a custom server. Nothing here benefits from SSR or server components. |
| Project discovery | **Manual list** | You add each project by folder. Nothing appears unasked. The picker reopens wherever you last browsed, and falls back to your home directory — no projects root is assumed anywhere, so the tool is portable to any machine. |
| Default permission mode | **`acceptEdits`** | Edits apply without prompting; bash still asks. Overridable per chat. |
| Agent transport | **`claude` CLI, headless** | Runs on the existing Claude subscription (OAuth) — no API key, no per-token billing. |
| Git access | **`simple-git`** (wraps the real `git` binary) | `stash` / `fetch` / `pull` / `revert` / `reset` all work. `isomorphic-git` is pure JS and missing exactly those. |
| Chat rendering | **Collapsible tool cards** | Text streams as prose; each edit / bash / read is a card with the diff or output inside. This is what makes the agent's actions reviewable. |
| Terminal | **Plain shell per project**, Phase 3 | A normal shell opened in the project folder, fully isolated from the agent's process, so it can never affect chat or git. |
| Commits | **Never automatic** | The agent edits the working tree. A human reads the diff and commits. |

---

## The safety model (one rule)

The agent edits the working tree. **It never commits, never pushes, never switches
branches.** You review the diff in the Changes tab and commit yourself.

That one rule replaces everything a heavier harness needs — no git worktrees, no
`agent/*` branches, no per-agent `npm ci`, no `.env` copying. The working tree is the
sandbox, `git diff` is the audit log, `git restore` is the undo.

Consequences to respect:

- Two chats in the same project share one working tree. Running them concurrently on
  the same files will interleave edits. The UI must show when a project already has a
  live chat.
- `bypassPermissions` stays a deliberate per-chat toggle, never a default.
- The Phase 3 terminal is *yours*. The agent never gets a PTY — it runs commands
  through its own Bash tool, and that output appears in the chat as a tool card.
- **Commit, push and pull are yours too.** They exist as buttons because *you* press them:
  every one confirms first, naming the branch, the remote and the commit count. No
  agent-reachable path touches them. Force-push, `reset --hard`, merge and rebase are
  absent on purpose — do those in a terminal, consciously.

---

## Architecture

```
browser (React, Vite)
   |  SSE          (chat stream)
   |  WebSocket    (terminal bytes, Phase 3)
   |  fetch        (everything else)
   v
Fastify (Node)
   |-- spawn: claude -p --output-format stream-json   (cwd = project path)
   |-- simple-git: status / diff / stage / commit / stash / fetch / pull
   +-- node-pty: one PTY per open terminal            (Phase 3)
   v
<wherever your repos live>       the real repo, real working tree
~/.flightdeck/state.json          projects + chats + session ids
```

### Agent transport — verified against Claude Code 2.1.233

```bash
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --include-partial-messages \
  --session-id <uuid> \
  --permission-mode acceptEdits
```

- `cwd` of the spawned process **is** the project. That is the whole "project scoping".
- Emits JSON lines (text chunks, tool calls, tool results) which are forwarded to the
  browser over SSE and rendered as prose + tool cards.
- Multi-turn: keep the process alive and write JSON messages to stdin, or re-invoke
  with `--resume <sessionId>`.
- `--add-dir` for a project that legitimately spans folders (e.g. `com8_realty`).
- **Do not use `--bare`** — its own docs state OAuth is never read and an API key is
  required. The plain form is what keeps this on the subscription.

Keep every process invocation inside `server/agent.ts`. If the Claude Agent SDK
(`@anthropic-ai/claude-agent-sdk`) turns out to authenticate with the subscription
too, swapping transport is then one file, not a rewrite.

### Chats and sub-chats

A chat *is* a session id. Nothing more.

```
Project (com8_studio)
|-- Chat "article schema"        session 7f3a...  permissionMode: acceptEdits
|   +-- Sub-chat "sanity side"   session 91b2...  (parentChatId set)
+-- Chat "perf pass"             session c4d1...
```

Sub-chats are ordinary chats with a `parentChatId` — they exist for grouping in the
sidebar, not for any special agent behaviour. One-to-many rows either way, so the data
model carries them from day one even though the sidebar UI lands in Phase 3.

### History replay

Reopening a chat must eventually show its past messages, not just resume silently.

Claude Code already persists this, so Flight Deck stores no message history of its own.
Transcripts live under `~/.claude/projects/<encoded-cwd>/` as JSONL — one record per
event, each with `type` (`user` / `assistant` / `attachment` / ...), a `message`
`{role, content}`, `uuid`, `timestamp`, and `cwd`. Encoded cwd example:
`E:\muhaz\CStudio\com8-sanity` becomes `E--muhaz-CStudio-com8-sanity`.

Replay = locate the file for `sessionId`, parse the JSONL, and render it through the
same components the live stream uses. Confirm the exact main-transcript filename at
implementation time (a session directory can also contain `subagents/*.jsonl`).

Phase 1 may resume without replay; Phase 2 renders it.

### State

`~/.flightdeck/state.json` — one file, written atomically (temp file + rename).

```jsonc
{
  "version": 1,
  "lastBrowsedDir": null,                    // where the picker reopens; null on a fresh install
  "projects": [
    {
      "id": "com8_studio",
      "name": "Com8 Studio",
      "path": "E:\\muhaz\\CStudio\\com8_studio",
      "addedAt": "2026-08-18T00:00:00Z",
      "defaultPermissionMode": "acceptEdits",
      "verifyCommand": "npm run build"      // optional, offered as a one-click check
    }
  ],
  "chats": [
    {
      "id": "...",
      "projectId": "com8_studio",
      "parentChatId": null,
      "title": "article schema",
      "sessionId": "7f3a...",               // the --session-id UUID
      "permissionMode": "acceptEdits",
      "createdAt": "...",
      "lastMessageAt": "..."
    }
  ]
}
```

---

## API surface

| Route | Purpose |
|---|---|
| `GET /api/projects` | list projects from state |
| `POST /api/projects` | add one (validate: absolute path, exists, is a git repo) |
| `DELETE /api/projects/:id` | remove from the list (never touches the folder) |
| `GET /api/fs/browse?dir=` | folder listing for the add-project picker |
| `GET /api/chats?projectId=` | chats + sub-chats for a project |
| `POST /api/chats` | create a chat (mints a session UUID) |
| `GET /api/chats/:id/history` | replayed transcript for this chat's session |
| `POST /api/chat/:id/message` | **SSE** — send a prompt, stream the agent's output |
| `POST /api/chat/:id/abort` | kill the child process for this chat |
| `GET /api/git/status?projectId=` | staged / unstaged / untracked |
| `GET /api/git/diff?projectId=&file=&staged=` | unified diff for one file |
| `POST /api/git/stage` · `unstage` · `discard` | per file |
| `POST /api/git/commit` | message + optional file subset |
| `POST /api/git/stash` · `stash-pop` · `stash-list` | |
| `POST /api/git/fetch` · `pull` | |
| `GET /api/git/branches` · `log` | branch list, recent commits |
| `POST /api/git/checkout` | guarded — refuse when the tree is dirty |
| `WS /ws/terminal?projectId=` | PTY bytes in/out, plus a `resize` message (Phase 3) |

Every git and terminal route takes a `projectId` and resolves the path from state —
**never** a path supplied by the client. That is the one input-validation rule that
really matters here.

---

## UI

```
+------------+------------------------------+---------------------+
| PROJECTS   |  CHAT                        |  CHANGES            |
|            |                              |                     |
| v Com8     |  +- chat: "article schema" -+|  M  src/app/page.tsx|
|   Studio   |  |  ...streamed prose...    ||  M  lib/schema.ts   |
|   |-article|  |  [+] Edit lib/schema.ts  ||  ?  docs/notes.md   |
|   +-perf   |  |  [+] Bash npm run build  ||                     |
| > Com8     |  +--------------------------+|  +- diff ----------+ |
|   Sanity   |  [ prompt input           ] |  | +  ...          | |
| + add      |  mode: acceptEdits v  [send] |  +----------------+ |
|            |                              |  [stage] [commit]   |
+------------+------------------------------+---------------------+
                         [ terminal ]  <- Phase 3, collapsible drawer
```

- **Left** — projects, each expanding to its chats. `+ add` opens the folder picker
  (reopens wherever you last browsed).
- **Middle** — the active chat. Prose streams inline; every tool call is a collapsible
  card (`[+] Edit lib/schema.ts`) holding the diff or command output. Permission-mode
  dropdown per chat: `acceptEdits` / `manual` / `bypassPermissions` / `plan`.
- **Right** — SCM for the active project: file list, diff, stage, commit, stash, fetch,
  pull.
- **Bottom** — Phase 3 terminal drawer, a plain shell in the project folder.
- A project with a live agent process shows a running indicator, so two chats don't
  quietly edit the same tree at once.

---

## Phases

**Phase 1 — talk to a project** (the only phase that must exist to be useful)

- Add / list / remove projects with the repo-aware folder picker
- Create a chat, send a prompt, stream the response
- Prose + collapsible tool cards
- Per-chat permission mode, defaulting to `acceptEdits`
- Abort a running chat; resume a chat by session id

**Phase 2 — see and commit what changed**

- `status` file list: staged / unstaged / untracked
- Diff view (Monaco diff editor)
- Stage / unstage / discard; commit with a message
- Stash, stash pop
- History replay when reopening a chat

**Phase 3 — terminal and the rest of source control**

- Plain shell per project (`node-pty` + `xterm.js` over WebSocket), collapsible drawer
- Fetch, pull, branch list + guarded checkout, commit history
- Sub-chats in the sidebar
- Per-project `verifyCommand` with a one-click run and output panel
- Per-project `CLAUDE.md` editor

---

## Risks and things to get right

- **Child-process lifecycle.** Map `chatId -> ChildProcess`. Kill on abort, on chat
  delete, and on server shutdown. An orphaned `claude` process holds a session and
  keeps working invisibly.
- **SSE plumbing.** Stream from Fastify with `Content-Type: text/event-stream` and no
  compression on that route. Verify with a slow response *before* building UI on it.
- **`node-pty` on Windows (Phase 3).** It installs from shipped prebuilds under plain
  Node — no compiler needed. Two known sharp edges: kill a PTY whose console has
  already exited and ConPTY's console-process enumeration can throw, and a browser
  refresh must dispose the PTY or processes leak. Own both explicitly.
- **Windows paths.** Backslashes in JSON, spaces in paths, `E:\` vs `/e/` between Node
  and any shell call. Always pass argv arrays, never a concatenated command string.
- **Concurrent chats, one working tree.** Documented above; surface it in the UI rather
  than trying to solve it.
- **Long output.** Stream, don't buffer. Large diffs need virtualised lists or the
  Changes tab will jank on a big refactor.

---

## Deferred (deliberately not in v1)

- Multi-agent anything — no orchestrator, no agent-to-agent messaging, no roster.
- Worktree isolation, per-agent branches.
- Any remote access, tunnel, or phone control.
- Scheduled or background runs. Nothing happens unless you press something.
