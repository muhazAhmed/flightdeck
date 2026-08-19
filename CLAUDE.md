# Working on Flight Deck

Instructions for any Claude session building this project. Read
[SPEC.md](./SPEC.md) for architecture, [FEATURES.md](./FEATURES.md) for scope,
[DESIGN.md](./DESIGN.md) for the visual system, [API.md](./API.md) for contracts, and
[DECISIONS.md](./DECISIONS.md) for why things are the way they are.

## What this is

A local, single-user console for working on ~20 repos at once: pick a project, chat with
Claude about it, review the diff, commit. Runs on `localhost`. No auth, no deploy, no
database.

## Stack

- **Vite + React + TypeScript** (client) · **Fastify** (server) · one repo, two dev
  processes
- **Tailwind v4** with CSS-variable tokens · **shadcn/ui** (15 components, listed in
  DESIGN.md) · **sonner** for toasts
- **`simple-git`** for git reads and staging · **`server/git-exec.ts`** (direct `spawn`) for
  remote and config operations — simple-git blocks inherited `GIT_ASKPASS`/`GIT_EDITOR`, see
  DECISIONS.md · **`node-pty` + `xterm.js`** over a WebSocket for the terminal (lazy chunk)
- **No Monaco.** Diffs are parsed by `client/features/changes/parseDiff.ts` (pure,
  tested) and rendered with our own tokens — see DECISIONS.md
- Agent = the **`claude` CLI headless**, spawned per chat

## Hard rules

1. **Never hardcode a color.** Every color comes from a token in DESIGN.md. If a value
   you need does not exist, add the token — do not inline a hex.
2. **Green and red are semantic only.** Added/succeeded and removed/failed. The accent
   is cyan. A decorative green anywhere is a bug.
3. **Never `setState` per streamed chunk.** Accumulate in a ref, flush on
   `requestAnimationFrame`. This is the difference between smooth and unusable.
4. **Never "Something went wrong."** Surface the real `git`/`claude` stderr, verbatim,
   with a copy button. Errors carry `{message, detail, code}`.
5. **Git paths resolve server-side from `projectId`.** A path from the client is never
   passed to `simple-git` or a spawn.
6. **The agent never commits, pushes, or switches branches.** It edits the working tree;
   the human reviews and commits. No `push` and no `reset --hard` route exists, and the only merge
   that exists is `--ff-only` — it moves a branch pointer or refuses, so it cannot conflict, cannot
   invent a merge commit and cannot lose work. A merge that would create a commit stays in a terminal.
7. **No new dependency without a reason in the commit message.** This tool should stay
   small enough to understand in one sitting.
8. **No machine, client or personal name anywhere.** Not in code, not in a comment, not in a fixture, not in a
   doc example, not as placeholder text. `test/portability.test.ts` enforces this and will fail the build —
   including a regression list of names that leaked once already. Use `C:/repos/app`, `/home/dev/app`,
   `you@example.com`.
9. **Windows first, never Windows-only.** Always pass argv arrays, never concatenated
   command strings. Paths have backslashes and sometimes spaces. Every platform-specific
   or machine-specific value belongs in `server/platform.ts` — a path literal anywhere
   else is a bug, because this project is intended to be open-sourced and must run on a
   machine that looks nothing like the author's.

## Conventions

- **Structure:** `client/` (React), `server/` (Fastify), `shared/` (types used by both).
  Server code that spawns anything lives in `server/agent.ts` and `server/pty.ts` —
  nowhere else.
- **Types are shared, not duplicated.** UI event and API shapes live in `shared/types.ts`
  and are imported by both halves.
- **Server modules are thin and testable.** Stream parsing (NDJSON → UI events) is a pure
  function over lines; test it against `docs/stream-sample.jsonl`.
- **No barrel files.** Import from the module that defines the thing.
- **Components:** one per file, named export, colocated with nothing else. Hooks in
  `client/hooks/`.
- **State:** local React state and a small store (Zustand if one is needed). No Redux, no
  React Query — this is one machine and a handful of endpoints.
- **Comments explain *why*.** The what is in the code. Non-obvious constraints (the rAF
  batching, the PTY disposal, the `--verbose` requirement) deserve a sentence.

## Verify before saying done

```bash
npm run typecheck      # tsc --noEmit, both halves
npm run lint
npm run build
```

Anything touching the agent stream must also be exercised against a real run, not only
the sample file. Anything touching git must be tried on a throwaway repo, never on one of the user's real
project repos — those are live client work.

## Do not

- Do not add Next.js, an ORM, a state-management framework, or a component library
  beyond shadcn.
- Do not add smooth-scrolling libraries (Lenis, Locomotive). They fight virtualisation
  and native scroll.
- Do not animate per-token text, or add spring/bounce motion anywhere.
- Do not introduce a `manual` permission mode until an approval channel is verified to
  exist (see API.md — this CLI has no `--permission-prompt-tool`).
- Do not build multi-agent anything: no orchestrator, no agent-to-agent messages, no
  worktrees, no scheduled runs. That was the previous attempt; it is not this one.
- Do not run experiments against the user's real project repos while developing Flight
  Deck itself. Create a scratch repo.

## Reference

`docs/stream-sample.jsonl` is a real captured `claude -p --output-format stream-json`
run. It is the source of truth for event shapes — prefer it over recollection, and
re-capture it if the CLI version changes.
