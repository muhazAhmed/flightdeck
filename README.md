<div align="center">

<img src="public/logo.png" alt="Flight Deck" width="96" height="96" />

# Flight Deck

**A local console for working on many repositories at once.**
Pick a project, talk to Claude about it, review the diff, commit it yourself.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-5FA04E.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](./tsconfig.json)
[![Runs locally](https://img.shields.io/badge/runs-localhost%20only-22D3EE.svg)](#security-and-privacy)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-6D28D9.svg)](#requirements)

[Why](#why) · [Features](#features) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Development](#development) · [FAQ](#faq)

</div>

---

Flight Deck drives the [Claude Code](https://claude.com/claude-code) CLI you already have
installed, one session per chat, with a source-control panel beside it. It is built for the
case an editor handles badly: a dozen or more active repositories, where the cost is not the
editing but the switching — a window per project, a chat per window, and no memory of the
last conversation about that repo.

No account, no deploy, no database. Nothing leaves `localhost`.

```
┌───────────────┬──────────────────────────────────┬───────────────────────┐
│ PROJECTS      │ CHAT                             │ CHANGES           3   │
│  Search…      │  Rate limiting                   │  main  ·  You         │
│───────────────│──────────────────────────────────│───────────────────────│
│  api-server   │  E:/repos/api-server             │  Fetch  Pull  Push    │
│  E:/repos/api │ ──────────────────────────────── │ ───────────────────── │
│               │  You                             │  Unstaged 3 | Staged 0│
│  web-app      │  Add rate limiting to /login     │ ───────────────────── │
│  E:/repos/web │                                  │   M src/routes/auth.ts│
│               │  v Edit  src/routes/auth.ts      │   M src/limiter.ts    │
│  sanity-cms   │  v Bash  npm test                │   ? test/limiter.ts   │
│  E:/repos/cms │                                  │ ───────────────────── │
│               │  Added a 5/min limiter and       │   + added line        │
│               │  a test for the 429 path.        │   - removed line      │
│───────────────│──────────────────────────────────│───────────────────────│
│  > Terminal   │  Ask about api-server…           │ Draft commit message  │
│  * You        │ ──────────────────────────────── │ [ Commit 3 files ]    │
│               │  PS E:/repos/api> npm run dev    │                       │
└───────────────┴──────────────────────────────────┴───────────────────────┘
```

<!-- Drop a real screenshot at docs/screenshot.png and replace the diagram above. -->

## Why

Twenty repositories is not twenty times one repository. The friction is elsewhere:

- **Context switching costs more than typing.** One editor window per project, each with its
  own chat, none of which remembers what you discussed about that repo yesterday.
- **Reviewing an agent's work is the actual job.** If an AI edits three files across two
  repos, you want the diff in front of you, not buried behind a file tree.
- **The dangerous half should stay manual.** Committing, pushing and branch switching are
  decisions. Everything else can be automated.

Flight Deck is those three things and nothing more: a project list, a chat per project, and
a diff you commit yourself.

## Features

### The deck
- **Every project on one screen** — branch, uncommitted count, how long that work has been sitting, ahead/behind, last commit, last agent run
- **Ranked by what wants you**, not alphabetically: a repo with changes rotting since Tuesday sits above six clean ones
- **Fetch every remote in one click**, so ahead/behind means something instead of reading a stale zero
- Costs no tokens — it is git and the filesystem, not an agent

This is the part an editor structurally cannot do: a window knows about one workspace, so "which of my
twenty repos have uncommitted work?" costs twenty windows to answer. Here it is a glance.

### Usage
- **Every run recorded** — model, turns, duration, notional cost, tokens — then aggregated per project, per model and per day
- **The current quota window**, bounded by the CLI's own reset time, showing which projects are eating it
- **Open a project up** — every run with model, turns, duration, tokens and cost, its most expensive chats, and one click from a run to the conversation behind it
- Cost is labelled notional throughout: a subscription is not billed per token, so the number is for comparing projects, not an invoice

### Projects
- Repo-aware folder picker — non-repositories are rejected with a real reason
- Nested repositories are separate projects, no special casing
- `Ctrl+K` jumps to any project or chat in two keystrokes
- Reopens the project you had open last, if it still exists

### Chat
- Multiple sessions per project, each a real `claude --session-id`
- Streamed responses, batched on `requestAnimationFrame` — text appears, never animates per token
- Collapsible tool cards with elapsed time, so a slow `npm ci` reads as working rather than hung
- Per-chat permission mode (`acceptEdits`, `plan`, `bypassPermissions`) and model pinning
- **Reopening a chat replays its history** — read from Claude Code's own transcripts, not a second copy
- **Adopt sessions started elsewhere** — a run from your terminal or editor can be imported and continued
- Attach files and screenshots: bytes go to disk, the *path* goes in the prompt, so a 2 MB image never becomes 2 MB of context
- **Slash command autocomplete** — type `/` for the project's commands and your skills, with descriptions and argument hints
- Quota chip from `rate_limit_event` — know before starting something big

### Source control
- Staged / unstaged / untracked lists, with branch and ahead-behind
- Diff viewer with real line numbers, parsed and rendered from our own tokens
- Stage, unstage, discard, commit, stash and stash pop — destructive actions name the exact files
- Fetch, pull (`--ff-only`, refuses on a dirty tree) and push (never forced, shows the commit count first)
- Branch list with each branch's last commit; checkout, create, delete, remote branches as tracking branches
- **Commit history** — a History tab with branch and tag chips, merge markers, per-file counts, and the diff of any file in any commit
- **Word-level diff highlighting** — the changed words inside a changed line, so a renamed identifier reads at a glance
- **Drafted commit messages** — reads the staged diff and writes an imperative subject; it lands in the box for editing and never commits
- **Per-repo git identity** — see who the next commit will be attributed to and switch in one click, `--local` only
- **Live updates while the agent works** — files appear as they are written, driven by the stream's own tool events
- **Trigger a build** — one button for an empty commit plus a push, for pipelines that only run on new commits; refused if anything is staged
- Switching branches fetches straight after, so ahead/behind is true rather than as stale as your last fetch

### Terminal
- A real PTY per project, in the project's folder, at the bottom of the centre column (`Ctrl+J`)
- **Profile picker showing only shells you actually have** — PowerShell, cmd, Git Bash, each WSL distro; `$SHELL`/zsh/bash/fish elsewhere
- WebGL renderer with a DOM fallback, 5000-line scrollback, lazily loaded so it costs nothing until opened
- Disposed on disconnect — a closed tab never leaves a shell running against your repo

### Interface
- Three resizable panels; the sidebar collapses to an icon rail and Changes to an edge tab
- Dark and light themes, seven contrast-checked accents, two densities
- A settings page where every switch does something — agent defaults and a turn cap, commit sign-off, terminal profile and type size, and a Privacy section that names the files on disk
- **Never "something went wrong"** — every failure carries the real `git` or `claude` stderr with a copy button
- **Update notifications** — tells you when your clone or fork is behind its own remote, lists what is coming, and fast-forwards in one click (never merges over your own commits)

## Requirements

| | |
|---|---|
| **Node.js** | 20 or newer |
| **[Claude Code](https://claude.com/claude-code)** | installed and authenticated, `claude` on your `PATH` |
| **git** | on your `PATH` |

Flight Deck drives the CLI you already use, so it runs on whatever plan or key that CLI is
configured with. **There is no separate API key to add.**

Tested on Windows 11, and written to be portable: every platform-specific value lives in
[`server/platform.ts`](./server/platform.ts), argv is always an array, and no path literal
appears anywhere else.

## Quick start

```bash
git clone https://github.com/muhazAhmed/flightdeck.git
cd flightdeck
npm install
npm run dev
```

Open **<http://localhost:5173>**, click **Add project**, and pick any folder that is a git
repository.

`npm run dev` runs two processes: Vite on `:5173` and Fastify on `:5174`. For a single
process serving both:

```bash
npm run build
npm start            # http://localhost:5174
```

## Configuration

Everything is optional — Flight Deck detects what it can and asks for the rest in the UI.

| Variable | Default | What it does |
|---|---|---|
| `CLAUDE_BIN` | resolved from `PATH` | Path to the `claude` binary, for unusual installs |
| `FLIGHTDECK_SHELL` | best shell detected | Overrides the terminal's shell entirely |
| `PORT` | `5174` | Server port |

Preferences you set in the UI — theme, accent, density, terminal profile, confirmation level
— live in `~/.flightdeck/state.json`, alongside your project list. Attachments go to
`~/.flightdeck/attachments/`, and one line per finished run to `~/.flightdeck/usage.jsonl`. Nothing is
written inside your repositories.

## Keyboard shortcuts

`Cmd` works in place of `Ctrl` on macOS.

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command palette — jump to any project or chat |
| `Ctrl+Shift+D` | The deck — every project at once |
| `Ctrl+Shift+U` | Usage — cost and quota per project |
| `Enter` | Send the prompt (`Shift+Enter` for a new line; `Ctrl+Enter` also sends) |
| `Ctrl+J` | Toggle the terminal |
| `Ctrl+B` | Toggle the project sidebar |
| `Ctrl+Shift+G` | Toggle the Changes panel |
| `Ctrl+,` | Settings |
| `Esc` | Leave settings |

## How it works

```
browser (React) ──SSE──►  Fastify  ──spawn──►  claude   (cwd = your repo)
                ──WS───►           ──spawn──►  a shell  (node-pty)
                                   ──────────►  git     (simple-git + direct spawn)
```

Each chat is one `claude` session spawned with the project folder as its working directory.
Its `stream-json` output is translated server-side into a small event set — a pure function
over lines, tested against a captured real run — and pushed to the browser over SSE, where
prose streams inline and every tool call renders as a collapsible card.

### The safety model

> **The agent edits your working tree. It never commits, never pushes, never switches
> branches.**

You review the diff and commit. That single rule is the whole safety model, and it is why
there are no worktrees, no agent branches, and no cleanup to think about: `git diff` is the
audit log and `git restore` is the undo. There is no `push` route the agent can reach, no
`reset --hard`, and no `merge`.

Git paths are resolved server-side from a project id. A path from the browser is never handed
to git.

## Project structure

```
client/
  app/            shell, panels, providers
  features/       projects · chat · changes · terminal · settings · command-palette
  shared/ui/      primitives
  lib/ hooks/ store/ styles/
server/
  index.ts        Fastify wiring
  agent.ts        the only module that spawns claude
  pty.ts          the only module that spawns a shell
  cli.ts          locating the claude binary across platforms
  stream.ts       NDJSON → UI events (pure, tested)
  shells.ts       which shells this machine actually has
  platform.ts     every platform-specific value, in one place
  routes/         projects · chats · git · branches · remote · terminal · settings
shared/types.ts   contracts used by both halves
test/             unit tests, run with node:test via tsx
```

## Development

```bash
npm run dev          # Vite :5173 + Fastify :5174, both watching
npm run typecheck    # tsc --noEmit, both halves
npm test             # node:test via tsx
npm run build        # bundle the client
```

A few rules this codebase actually holds itself to — the full set, with reasoning, is in
[CLAUDE.md](./CLAUDE.md):

1. **Never hardcode a color.** Every color is a token from [DESIGN.md](./DESIGN.md).
2. **Green and red are semantic only** — added/succeeded and removed/failed. The accent is cyan.
3. **Never `setState` per streamed chunk.** Accumulate in a ref, flush on `requestAnimationFrame`.
4. **Never "something went wrong."** Surface the real stderr, verbatim, with a copy button.
5. **The agent never commits, pushes, or switches branches.**
6. **No new dependency without a reason in the commit message.** This tool should stay small
   enough to understand in one sitting.
7. **Windows first, never Windows-only.** Always argv arrays, never concatenated command
   strings; every machine-specific value in `server/platform.ts`.

Two things worth knowing before you write a test here: several of this project's real bugs
(`--verbose` being required, `GIT_ASKPASS` being blocked, a 164 KB diff hitting
`ENAMETOOLONG`) typechecked cleanly and passed unit tests, and only appeared against real
data on a real machine. So anything touching the agent stream must also be exercised against
a live run, and anything touching git must be tried on a **throwaway repo** —
[`docs/stream-sample.jsonl`](./docs/stream-sample.jsonl) is a captured real run for the
parts that can be tested offline.

## Roadmap

Next up: commit history, sub-chats, a per-project verify command, and branch/change counts on
the sidebar rows. [FEATURES.md](./FEATURES.md) is the full inventory, phase-tagged, including
what is deliberately excluded.

### Non-goals

Recorded so the project does not drift back into them:

- **No orchestrator, no multi-agent routing, no agent-to-agent messaging.** One agent per
  chat; you decide who does what.
- **No worktrees or per-agent branches.** The working tree is the sandbox.
- **No scheduled or background runs.** Nothing happens unless you press something.
- **No remote access, tunnel, or phone control.** `localhost` only.
- **No editor.** The diff viewer shows changes; it is not a second VS Code.
- **No auth, no multi-user, no deploy.** One machine, one person.

## Security and privacy

- The server binds to `127.0.0.1`. It has **no authentication**, because it is not meant to
  be reachable — do not expose the port or put it behind a tunnel.
- No telemetry, no analytics, no network calls of its own. The only outbound traffic is
  whatever the `claude` CLI and `git` make on your behalf.
- Your code is never copied anywhere. Flight Deck reads your repositories in place and
  writes only to `~/.flightdeck/`.
- Attachments are stored unencrypted in `~/.flightdeck/attachments/` until you delete them.

## FAQ

**Does this need an API key?**
No. It spawns the `claude` CLI you already authenticated, so it uses whatever plan that CLI
is signed in with.

**Can the agent commit or push my work?**
No. Those routes do not exist. It edits files; you review and commit.

**Can I run it on a server and use it from my phone?**
Not supported, and deliberately so — there is no auth. It is a `localhost` tool.

**Why a browser tab instead of an editor extension?**
Because the problem being solved is having twelve editor windows open. One tab holding every
project is the point.

**Does it work if I also use Claude Code in my terminal?**
Yes. Sessions started elsewhere in a project's folder can be imported and continued, since
Flight Deck reads the CLI's own transcripts rather than keeping its own.

**Two chats in one project — do they conflict?**
They share one working tree, so treat them like two people editing the same checkout: the
Changes panel shows the combined result. A warning in the UI for this is still on the roadmap.

## Documentation

| File | What is in it |
|---|---|
| [SPEC.md](./SPEC.md) | architecture, safety model, phases |
| [FEATURES.md](./FEATURES.md) | every feature, phase-tagged, plus what is deliberately excluded |
| [DESIGN.md](./DESIGN.md) | design tokens, typography, layout, motion, message channels |
| [API.md](./API.md) | the CLI stream schema (captured from a real run) and every route |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | branching, commits, PR expectations, what will be turned down |
| [CLAUDE.md](./CLAUDE.md) | conventions and hard rules for working on this codebase |
| [DECISIONS.md](./DECISIONS.md) | why things are the way they are, and what would change each one |

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Read [CONTRIBUTING.md](./CONTRIBUTING.md) — branching, commit format, and what a PR has to prove. The
   hard rules in [CLAUDE.md](./CLAUDE.md) are short and non-negotiable, and [DECISIONS.md](./DECISIONS.md)
   probably explains why something odd is the way it is.
2. Run `npm run typecheck` and `npm test`.
3. If you touched the agent stream or git, say in the PR **what you ran it against** — a real
   run, a throwaway repo. "Tests pass" is not enough here, for the reasons above.
4. New dependency? Justify it in the commit message.

Bug reports are most useful with the verbatim error text — Flight Deck shows you the real
`git`/`claude` stderr specifically so it can be pasted.

## License

[MIT](./LICENSE)
