# Flight Deck — features

What the tool does, grouped by area, each tagged with the phase it lands in.

`P1` = must exist to be useful · `P2` = makes it trustworthy · `P3` = makes it pleasant
· `Later` = agreed idea, no commitment

---

## Projects

| Feature | Phase | Notes |
|---|---|---|
| Add a project by folder | **done** | Picker opens where you last browsed (home directory on a fresh install) and marks which folders are git repos. Rejects non-repos with a real reason. |
| Deck — every project at once | **done** | The one screen an editor cannot have. A card per project: branch, uncommitted count, how long that work has been sitting, ahead/behind, last commit, last agent run. Ranked by what wants you, not alphabetically, so work rotting since Tuesday sits above six clean repos. One button fetches every remote so ahead/behind stops being a stale zero. No agent, no tokens. `Ctrl+Shift+D`. |
| Project list in sidebar | **partly** | Name, path, expandable chat list and a running indicator are in. **Branch and changed-file count on the row are not** — the deck shows both, the sidebar does not. |
| Rename / remove from list | **partly** | Removing works and never touches the folder on disk. **Rename has a route (`PATCH /api/projects/:id`) and no UI.** |
| Nested repos as separate projects | **done** | `acme/web/storefront` and `acme-server` are two projects. No special casing. |
| `Ctrl+K` jump to any project or chat | **done** | The real answer to "twenty projects is hard to manage". Two keystrokes and a few letters. |
| Per-project default permission mode | **partly** | Stored per project and seeded from settings when a project is added. **No per-project UI to change it afterwards** — the route accepts it, nothing calls it. |
| Git identity switcher | **done** | Shows who the next commit will be attributed to, right above the commit box, and switches in one click. Writes `--local` only, so the machine default is never changed. Saved identities persist for reuse. |
| Per-project verify command | P3 | `npm run build`, `npm test`, `npm run typecheck` — one click, output in a panel. The `verifyCommand` field already exists on the project route; nothing sets or runs it. |
| Per-project `CLAUDE.md` editor | P3 | Edit the instructions the agent reads, without leaving the tool. |
| Project groups / tags | Later | Only if the flat list actually becomes unwieldy. |

## Chat

| Feature | Phase | Notes |
|---|---|---|
| Multiple chats per project | **done** | Each chat is a `--session-id` UUID. |
| Import existing sessions | **done** | Any Claude Code session run in a project's folder — from your editor, a terminal, or an earlier install — can be adopted and read. Sessions touched in the last few minutes are flagged as probably open elsewhere. |
| Streaming responses | **done** | rAF-batched; text appears, never animates per token. |
| Collapsible tool cards | **done** | Edit / Bash / Read / Glob / Grep each render appropriately. |
| Markdown in the transcript | **done** | Headings, bold, lists, tables, links, inline code chips and fenced blocks, every element styled from the design tokens. Your own messages stay verbatim — markdown there would reformat your words back at you. |
| Delete a chat | **done** | Asks first, and names what is not obvious from the row: a running agent is stopped, sub-chats go with the parent, and the CLI keeps the transcript so it can be imported back. |
| Stop a running chat | **done** | Always one click away. SIGTERM then SIGKILL. |
| Resume a chat | **done** | Reopen and keep talking — same session, full context. |
| Per-chat permission mode | **done** | `acceptEdits` default, `plan`, `bypassPermissions` (with a warn banner). |
| Model switcher per chat | **done** | Pins Opus 5 / Sonnet 5 / Haiku 4.5, or leaves the CLI default. Passed as `--model`; with nothing pinned the header shows what the session actually reported. |
| Search projects | **done** | Filters on name and path. `Ctrl+K` still reaches anything in two keystrokes. |
| Staged / Unstaged tabs | **done** | With counts, and the panel follows the work — staging everything moves you to Staged, committing moves you back. |
| History replay on reopen | **done** | Rendered from Claude Code's own transcript through the same reducer as the live stream, so a resumed chat is indistinguishable from one you watched. |
| Usage — cost and quota per project | **done** | Every finished run is logged: model, turns, duration, notional cost, and the four token counts kept apart. Aggregated per project, per model and per day, plus the current five-hour window bounded by the CLI's own reset time. Also reads Claude Code's own transcripts, so conversations you ran in a terminal or an editor are counted (tokens only — a transcript records no cost). Answers which client is eating the window and what a month on a repo came to — the CLI reports one run and forgets it. Click any project to open it up: every run listed with model, turns, duration, tokens and cost, its chats ranked by cost, and one click from a run to the conversation that caused it. `Ctrl+Shift+U`. |
| Rate-limit / quota chip | **done** | From `rate_limit_event`: window type and reset time, in the chat header. Know before starting something big. |
| Run summary line | **done** | Turns, duration, notional cost and permission denials, from the `result` event. |
| Sub-chats | **partly** | `parentChatId` exists end to end and the delete dialog counts children. **Nothing creates one and the sidebar does not nest them** — the data model is ready, the UI is not. |
| Attach files and images | **done** | Paste a screenshot, drop files, or use the paperclip. Bytes are saved to `~/.flightdeck/attachments/` and the *path* is appended to the prompt, so the agent reads what it needs with its own Read tool — no truncation, and a 2 MB screenshot never becomes 2 MB of context. The directory is granted to each run with `--add-dir`, without which the CLI refuses to read there at all. |
| Slash commands and skills | **done** | Typing `/` lists the project's commands and your skills, with descriptions and argument hints. Arrows to move, Enter or Tab to insert, Esc to dismiss. Read from `.claude/commands` and `.claude/skills`; confirmed to actually run headless before it was built. |
| Edit-and-resend a prompt | Later | |
| Fork a chat | Later | `--fork-session` resumes into a new session id. Cheap to add if wanted. |
| Voice input | Later | Nice, not needed. |

## Source control

| Feature | Phase | Notes |
|---|---|---|
| Status list | **done** | Staged / unstaged / untracked, with branch and ahead/behind. |
| Diff viewer | **done** | Our own parser and renderer with real line numbers, themed from the diff tokens. Monaco was dropped deliberately — see DECISIONS.md. |
| Stage / unstage per file | **done** | |
| Commit | **done** | Message box, commits staged or a chosen subset. |
| Drafted commit message | **done** | Sparkle button in the message box reads the staged diff and writes a message: imperative subject under 72 chars, body only when the reason is not obvious. Lands in the box for editing — it never commits, and it warns if the diff was too large to send whole. |
| Discard changes | **done** | Destructive — confirm names the exact file. |
| Stash / stash pop / stash list / drop | **done** | Stash with a message, restore, or delete without applying. Deleting always asks and names the stash, whatever the confirmation level, because it is the one action here with no way back — and the request is checked against the stash it was shown, since dropping one renumbers the rest. |
| Live update while the agent works | **done** | Files appear in the panel as the agent edits, without waiting for the run to end. Driven by the stream's own tool events (debounced, 700ms with a 4s ceiling), so there is no polling and no watcher. Refreshes are quiet: no spinner, no error banner from a failed background read, and skipped outright while you are mid-stage or mid-commit. |
| Trigger a build | **done** | Button in the terminal header: an empty commit plus a push, for pipelines that only run on new commits. Refuses when anything is staged — an empty commit would carry it along — and if the push fails it says the commit was made and how to remove it. |
| Fetch / pull / push | **done** | Pull is `--ff-only` and refuses on a dirty tree; push is human-only, never forced, and shows the commit count before you confirm. |
| Branch list, checkout, create, delete | **done** | Picker shows each branch's last commit and date. A switch fetches straight afterwards, so ahead/behind is true for the branch you just landed on rather than as stale as your last fetch. Checkout refuses on a dirty tree; creating a branch deliberately carries your changes. Delete refuses when commits exist nowhere else, and force is a separate confirmation. Remote branches check out as tracking branches. |
| Commit history | **done** | A History tab beside Staged and Unstaged: commits with sha, author, age, branch and tag chips, and a merge marker. Expand one for its message body and files with per-file counts; click a file for its diff. Paged, read-only — no revert or reset, and no route that could become one. |
| Word-level diff highlighting | **done** | Changed words inside a changed line are picked out, so a renamed identifier reads at a glance. Token-level LCS, and lines too dissimilar to be an edit of each other are left plain rather than striped. |
| Push | **No** | Deliberately absent. See the safety rule. |
| Fast-forward onto another ref | **done** | `git merge --ff-only origin/dev` from the branch menu, for the workflow where a pull request lands on the host and the trunk needs to catch up. It moves the pointer or refuses — no merge commit, no conflict, nothing pushed. Refuses a dirty tree, the branch you are on, and an unknown ref; warns when you are not on the default branch. |
| Merge that creates a commit, rebase, reset --hard | **No** | Anything that can conflict, invent a merge commit or rewrite history stays in a terminal, consciously. |

## Terminal

| Feature | Phase | Notes |
|---|---|---|
| Plain shell per project | **done** | `node-pty` + `xterm.js` over a WebSocket, opened in the project's folder. Sits at the bottom of the centre column, drag-resizable, `Ctrl+J`. Profile picker lists the shells actually detected on the machine — PowerShell, cmd, Git Bash, each WSL distro; `$SHELL`/zsh/bash/fish elsewhere. Choice persists in settings; `FLIGHTDECK_SHELL` overrides. |
| WebGL renderer, capped scrollback | **done** | 5000 lines, WebGL with a DOM fallback when no GL context is available. |
| Dispose PTY on disconnect | **done** | Verified: two shells, sockets terminated without a close handshake, both processes gone. |
| Loaded on demand | **done** | xterm is ~450 kB, so it is a lazy chunk — the terminal is opt-in and most sessions never open one. |
| Multiple terminals per project | Later | One is enough to start. |
| The agent getting a PTY | **No** | The agent uses its own Bash tool; output appears as a tool card. Keeps the two systems unable to break each other. |

## Shell, UX, and feedback

| Feature | Phase | Notes |
|---|---|---|
| Three resizable, collapsible panels | **partly** | Resizing and collapsing both work — sidebar to an icon rail, Changes to an edge tab. **Widths do not persist**; `state.layout` exists and is never written. |
| Four message channels | **done** | Inline / toast / banner / tool-card error. One job each. |
| Real errors, never "something went wrong" | **done** | Every failure carries `git`/`claude` stderr and a copy button. |
| Keyboard shortcuts | **done** | `Ctrl+K`, `Enter` to send (`Shift+Enter` for a newline), `Ctrl+B`, `Ctrl+Shift+G`, `Ctrl+J`, `Ctrl+,`, `Esc`. |
| Empty / loading / disconnected states | **partly** | Skeletons rather than full-page spinners, and a persistent banner when the server is unreachable. **The banner has no retry button** — it clears on the next successful request. |
| Concurrent-chat warning | P1 | Two chats in one project share one working tree — the UI says so instead of pretending otherwise. |
| Elapsed time on long tool cards | **done** | A slow `npm ci` reads as working, not hung. |
| Update notifications | **done** | Tells you when your clone or fork is behind its own remote: a toast once per launch with a View action, and an Updates section listing the incoming commits with a one-click fast-forward. Asks git, not a web API, so a fork compares against the fork and no token is involved. Refuses on a dirty tree or a diverged fork rather than merging. Can be turned off. |
| Settings page | **done** | Six sections, all real: General (appearance, confirmations, startup), Git & Commit (sign-off, drafting model), AI Assistant (default model, permission mode for new projects, turn cap), Terminal (profile, font size, cursor), Shortcuts (reference), Privacy (what is on disk, with paths and a purge). Nothing is a disabled placeholder any more. |
| Light theme | **done** | A full light surface stack, measured, plus `color-scheme` so form controls and scrollbars follow. |
| Accent colours | **done** | Seven, each a contrast-checked fill/bright pair with a light-theme companion. Green, amber and red are labelled where they collide with diff or status meaning. |
| Interface density | **done** | Comfortable / compact, driven by the type scale. |
| Pinnable launcher | **done** | `npm run shortcut` writes a desktop launcher for your checkout — `.lnk`, `.command` or `.desktop` depending on the platform, with the Flight Deck icon. Clicking it starts the dev server, waits for the client to answer, then opens the browser; clicking it again just opens the tab. Generated, never committed. |
| Reopen last project | **done** | Restores the project you had open, once, and only if it still exists. |
| Confirmation level | **done** | Every action, or only the irreversible ones. Discard and force-delete always ask regardless. |
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

## Where it stands

**48 features done. Nothing left in P1 or P2 as a whole feature** — the remaining work is six partial rows,
five P3 items, and six deliberately-deferred ones.

The six partials are the honest list of "it works but not completely":

| Gap | What is missing |
|---|---|
| Sidebar rows | branch and changed-file count (the deck has both) |
| Rename a project | `PATCH /api/projects/:id` exists; nothing calls it |
| Per-project permission mode | same route, same problem — settable at add time only |
| Sub-chats | `parentChatId` works end to end; nothing creates one |
| Panel widths | resize works, `state.layout` is never written |
| Disconnected banner | no retry button; it clears on the next successful request |

Three of those six are one small settings surface away from done, since the server route already accepts
`name`, `defaultPermissionMode` and `verifyCommand`.

P1 and P2 were "talk to a project" and "see and commit what changed". Both are complete, which was the bar
for replacing the thing that started this: juggling twenty editor windows to work on four projects at once.
