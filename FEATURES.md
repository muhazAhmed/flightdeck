# Flight Deck — features

What the tool does, grouped by area, each tagged with the phase it lands in.

`P1` = must exist to be useful · `P2` = makes it trustworthy · `P3` = makes it pleasant
· `Later` = agreed idea, no commitment

---

## Projects

| Feature | Phase | Notes |
|---|---|---|
| Add a project by folder | P1 | Picker opens where you last browsed (home directory on a fresh install) and marks which folders are git repos. Rejects non-repos with a real reason. |
| Project list in sidebar | P1 | Name, current branch, changed-file count, running indicator. |
| Rename / remove from list | P1 | Removing never touches the folder on disk. |
| Nested repos as separate projects | P1 | `com8_realty/web/Com8-Reality` and `com8_realty_server` are two projects. No special casing. |
| `Ctrl+K` jump to any project or chat | P1 | The real answer to "twenty projects is hard to manage". Two keystrokes and a few letters. |
| Per-project default permission mode | P2 | `temp/` can be permissive, client repos strict. |
| Git identity switcher | **done** | Shows who the next commit will be attributed to, right above the commit box, and switches in one click. Writes `--local` only, so the machine default is never changed. Saved identities persist for reuse. |
| Per-project verify command | P3 | `npm run build`, `npm test`, `npm run typecheck` — one click, output in a panel. |
| Per-project `CLAUDE.md` editor | P3 | Edit the instructions the agent reads, without leaving the tool. |
| Project groups / tags | Later | Only if the flat list actually becomes unwieldy. |

## Chat

| Feature | Phase | Notes |
|---|---|---|
| Multiple chats per project | P1 | Each chat is a `--session-id` UUID. |
| Import existing sessions | **done** | Any Claude Code session run in a project's folder — from your editor, a terminal, or an earlier install — can be adopted and read. Sessions touched in the last few minutes are flagged as probably open elsewhere. |
| Streaming responses | P1 | rAF-batched; text appears, never animates per token. |
| Collapsible tool cards | P1 | Edit / Bash / Read / Glob / Grep each render appropriately. |
| Markdown in the transcript | **done** | Headings, bold, lists, tables, links, inline code chips and fenced blocks, every element styled from the design tokens. Your own messages stay verbatim — markdown there would reformat your words back at you. |
| Stop a running chat | P1 | Always one click away. SIGTERM then SIGKILL. |
| Resume a chat | P1 | Reopen and keep talking — same session, full context. |
| Per-chat permission mode | P1 | `acceptEdits` default, `plan`, `bypassPermissions` (with a warn banner). |
| Model switcher per chat | **done** | Pins Opus 5 / Sonnet 5 / Haiku 4.5, or leaves the CLI default. Passed as `--model`; with nothing pinned the header shows what the session actually reported. |
| Search projects | **done** | Filters on name and path. `Ctrl+K` still reaches anything in two keystrokes. |
| Staged / Unstaged tabs | **done** | With counts, and the panel follows the work — staging everything moves you to Staged, committing moves you back. |
| History replay on reopen | **done** | Rendered from Claude Code's own transcript through the same reducer as the live stream, so a resumed chat is indistinguishable from one you watched. |
| Rate-limit / quota chip | P2 | From `rate_limit_event`: window type and reset time. Know before starting something big. |
| Run summary line | P2 | Turns, duration, notional cost, permission denials — from the `result` event. |
| Sub-chats | P3 | A chat with `parentChatId`. Grouping in the sidebar; no special agent behaviour. |
| Attach files and images | **done** | Paste a screenshot, drop files, or use the paperclip. Bytes are saved to `~/.flightdeck/attachments/` and the *path* is appended to the prompt, so the agent reads what it needs with its own Read tool — no truncation, and a 2 MB screenshot never becomes 2 MB of context. |
| Slash commands and skills | P3 | `system/init` already lists what's available; surface them as autocomplete. |
| Edit-and-resend a prompt | Later | |
| Fork a chat | Later | `--fork-session` resumes into a new session id. Cheap to add if wanted. |
| Voice input | Later | Nice, not needed. |

## Source control

| Feature | Phase | Notes |
|---|---|---|
| Status list | P2 | Staged / unstaged / untracked, with branch and ahead/behind. |
| Diff viewer | P2 | Monaco diff editor, themed to the diff tokens. One instance, models swapped. |
| Stage / unstage per file | P2 | |
| Commit | P2 | Message box, commits staged or a chosen subset. |
| Drafted commit message | **done** | Sparkle button in the message box reads the staged diff and writes a message: imperative subject under 72 chars, body only when the reason is not obvious. Lands in the box for editing — it never commits, and it warns if the diff was too large to send whole. |
| Discard changes | P2 | Destructive — confirm names the exact file. |
| Stash / stash pop / stash list | P2 | |
| Live update while the agent works | P2 | Files appear in the panel as it edits. Half the appeal of the tool. |
| Fetch / pull / push | **done** | Pull is `--ff-only` and refuses on a dirty tree; push is human-only, never forced, and shows the commit count before you confirm. |
| Branch list, checkout, create, delete | **done** | Picker shows each branch's last commit and date. Checkout refuses on a dirty tree; creating a branch deliberately carries your changes. Delete refuses when commits exist nowhere else, and force is a separate confirmation. Remote branches check out as tracking branches. |
| Commit history | P3 | Recent commits, click for the diff. |
| Word-level diff highlighting | P3 | |
| Push | **No** | Deliberately absent. See the safety rule. |
| Merge / rebase / reset --hard | **No** | Do those in a terminal, consciously. |

## Terminal

| Feature | Phase | Notes |
|---|---|---|
| Plain shell per project | P3 | `node-pty` + `xterm.js` over WebSocket, `cwd` = project. Collapsible bottom drawer. |
| WebGL renderer, capped scrollback | P3 | ~5000 lines. Performance is a constraint, not an optimisation. |
| Dispose PTY on disconnect | P3 | A browser refresh must not leak a process. |
| Multiple terminals per project | Later | One is enough to start. |
| The agent getting a PTY | **No** | The agent uses its own Bash tool; output appears as a tool card. Keeps the two systems unable to break each other. |

## Shell, UX, and feedback

| Feature | Phase | Notes |
|---|---|---|
| Three resizable, collapsible panels | P1 | Widths persist. Sidebar collapses to an icon rail; Changes collapses to an edge tab. |
| Four message channels | P1 | Inline / toast / banner / tool-card error. One job each. |
| Real errors, never "something went wrong" | P1 | Every failure carries `git`/`claude` stderr and a copy button. |
| Keyboard shortcuts | P1 | `Ctrl+K`, `Ctrl+Enter`, `Ctrl+B`, `Ctrl+Shift+G`, `Esc`. |
| Empty / loading / disconnected states | P1 | Skeletons, not full-page spinners. Server-down is a persistent banner with retry. |
| Concurrent-chat warning | P1 | Two chats in one project share one working tree — the UI says so instead of pretending otherwise. |
| Elapsed time on long tool cards | P2 | A slow `npm ci` should read as working, not hung. |
| Light theme | Later | Tokens make it a swap, not a refactor. |
| Command palette actions (not just navigation) | Later | "commit", "stash", "new chat" from `Ctrl+K`. |

## Explicitly not in this tool

Recorded so we don't drift back into it:

- **No orchestrator, no multi-agent routing, no agent-to-agent messaging.** One agent per chat, you decide who does what.
- **No worktrees or per-agent branches.** The working tree is the sandbox; `git diff` is the audit trail.
- **No scheduled or background runs.** Nothing happens unless you press something — no hourly standup quietly spending tokens.
- **No remote access, tunnel, or phone control.** `localhost` only.
- **No editor.** Monaco is there to *show* diffs, not to become a second VS Code.
- **No auth, no multi-user, no deploy.** One machine, one person.

---

## Phase summary

**P1 — talk to a project.** Projects list + picker, `Ctrl+K`, chats with streaming and
tool cards, permission mode per chat, stop/resume, three resizable panels, the four
message channels, real errors.

**P2 — see and commit what changed.** Full status/diff/stage/commit/discard/stash, live
updates during a run, history replay, quota chip, run summary.

**P3 — terminal and the rest.** Shell drawer, fetch/pull/branches/log, sub-chats,
verify command, `CLAUDE.md` editor.

If P1 and P2 exist, the tool has replaced the thing you actually complained about:
juggling twenty VS Code windows to work on four projects at once.
