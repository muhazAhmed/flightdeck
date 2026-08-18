# Flight Deck

A local console for working on many repositories at once. Pick a project, talk to Claude
about it, watch what changed, commit it yourself.

Built for the case VS Code handles badly: a dozen or more active repos, where the cost is
not the editing but the switching — a window per project, a chat per window, and no memory
of the last conversation about that repo.

Runs entirely on your machine. No account, no deploy, no database, nothing leaves
`localhost`.

## Requirements

- **Node.js 20+**
- **[Claude Code](https://claude.com/claude-code)** installed and authenticated
  (`claude` on your `PATH`). Flight Deck drives the CLI you already use, so it runs on
  whatever plan or API key that CLI is configured with — there is no separate key to add.
- **git** on your `PATH`

## Getting started

```bash
npm install
npm run dev          # Vite on :5173, Fastify on :5174
```

Open <http://localhost:5173>, click **Add project**, and pick any folder that is a git
repository.

```bash
npm run build        # bundle the client
npm start            # serve client + API from one process
npm run typecheck
npm test             # stream parser, against a real captured CLI run
```

If `claude` lives somewhere unusual, point Flight Deck at it:

```bash
CLAUDE_BIN=/path/to/claude npm run dev
```

## How it works

Each chat is one `claude` session (`--session-id`), spawned with the project folder as its
working directory. Its `stream-json` output is translated server-side into a small event
set and pushed to the browser over SSE, where prose streams inline and every tool call
renders as a collapsible card.

```
browser (React)  ──SSE──►  Fastify  ──spawn──►  claude   (cwd = your repo)
                                    ──simple-git──►  git
```

**The agent edits your working tree. It never commits, never pushes, never switches
branches.** You review the diff and commit. That single rule is the whole safety model —
it is why there are no worktrees, no agent branches, and no cleanup to think about. `git
diff` is the audit log and `git restore` is the undo.

## Status

**Working end to end:**

- Projects — repo-aware folder picker, sidebar with branch and change count, `Ctrl+K` to
  jump to any project or chat
- Chat — multiple sessions per project, streamed responses, collapsible tool cards,
  per-chat permission mode, stop mid-run
- Source control — staged/changed/untracked lists, diff viewer with real line numbers,
  stage, unstage, discard, commit, stash and stash pop, plus fetch / pull / push. Every
  action confirms first and names the exact files. A refresh fires automatically when an
  agent run finishes
- History — reopening a chat replays its past messages, read from Claude Code's own
  transcripts rather than a second copy Flight Deck keeps
- Git identity — see who the next commit will be attributed to and switch per repository in
  one click, without touching your global config

**Not built yet:** branch switching, commit history, sub-chats, the terminal drawer,
per-project verify command. See
[FEATURES.md](./FEATURES.md) for the full inventory and which phase each belongs to.

## Documentation

| File | What is in it |
|---|---|
| [SPEC.md](./SPEC.md) | architecture, safety model, phases |
| [FEATURES.md](./FEATURES.md) | every feature, phase-tagged, plus what is deliberately excluded |
| [DESIGN.md](./DESIGN.md) | design tokens, typography, layout, motion, message channels |
| [API.md](./API.md) | the CLI stream schema (captured from a real run) and every route |
| [CLAUDE.md](./CLAUDE.md) | conventions and hard rules for working on this codebase |
| [DECISIONS.md](./DECISIONS.md) | why things are the way they are, and what would change each one |

## Layout

```
client/
  app/                 shell, panels, providers
  features/            projects · chat · changes · command-palette
  shared/ui/           primitives
  lib/  hooks/  store/  styles/
server/
  index.ts             Fastify wiring
  agent.ts             the only module that spawns claude
  cli.ts               locating the claude binary across platforms
  stream.ts            NDJSON → UI events (pure, tested)
  platform.ts          every platform-specific value, in one place
  routes/              projects · chats · git
shared/types.ts        contracts used by both halves
```

## License

MIT
