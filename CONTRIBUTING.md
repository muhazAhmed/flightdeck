# Contributing to Flight Deck

Thanks for looking. This document is the whole process: how to get set up, how branches and commits are
named, what a pull request has to prove, and the handful of rules that are not up for negotiation.

Read [CLAUDE.md](./CLAUDE.md) before your first change — it is short, and it is the same set of rules the
maintainers work under. [DECISIONS.md](./DECISIONS.md) explains why anything odd is the way it is; check it
before proposing that something odd be changed.

---

## Getting set up

```bash
git clone https://github.com/muhazAhmed/flightdeck.git
cd flightdeck
npm install
npm run dev          # Vite on :5173, Fastify on :5174
```

You need **Node 20+**, **git**, and the [Claude Code](https://claude.com/claude-code) CLI on your `PATH`.
There is no separate API key — Flight Deck drives the CLI you already authenticated.

Working on a fork? The Updates section in settings compares your install against **your** remote, so it will
tell you when your fork is behind and refuse to fast-forward over your own commits.

## Branching

Branch from `main`. Never commit to `main` directly, even on a fork you own — a PR from a named branch is
reviewable and a PR from `main` is a nuisance to update.

```
<type>/<short-description>
```

| Prefix | For |
|---|---|
| `feat/` | a new capability |
| `fix/` | a bug, with the symptom in the name |
| `docs/` | documentation only |
| `refactor/` | no behaviour change |
| `test/` | tests only |
| `chore/` | dependencies, tooling, housekeeping |

Good: `fix/attachment-read-permission`, `feat/cross-repo-search`, `docs/contributing-guide`.
Not: `patch-1`, `muhaz-changes`, `fix-stuff`, `dev`.

One branch is one change. If you cannot describe it in the branch name, it is probably two branches.

**Rebase, do not merge.** Keep your branch current with `git fetch origin && git rebase origin/main`. Merge
commits from `main` into a feature branch make the diff unreadable during review.

## Commits

```
Add a short imperative subject under 72 characters

Explain why this change exists, if the reason is not obvious from the diff. Wrap at
about 100 characters. The code says what changed; the message says why it had to.

Closes #123
```

Rules, in order of how much they matter:

1. **Imperative subject, under 72 characters, no trailing full stop.** "Add the terminal profile picker",
   not "Added..." or "Adding..." or "terminal stuff".
2. **The body explains why.** Skip it when the subject is genuinely the whole story. Never write a body that
   restates the diff.
3. **A new dependency needs its reason in the commit message.** This tool should stay small enough to
   understand in one sitting, so "why not the thing we already have" belongs in the log where it survives.
   `package.json` changes without a justification will be asked about.
4. **One logical change per commit.** Formatting-only churn goes in its own commit, so review can skip it.
5. **Never commit secrets, tokens, `.env` files, or anything from `~/.flightdeck/`.** That directory holds
   attachments and usage logs from real machines.
6. **Do not commit generated output.** `dist/` and `node_modules/` are ignored; keep it that way.

If your history got messy while you worked, tidy it before opening the PR — `git rebase -i origin/main`,
squash the "fix typo" commits, keep the ones that tell a story.

## Before you open a pull request

```bash
npm run typecheck    # tsc --noEmit, both halves, no errors
npm test             # every test must pass
npm run build        # must succeed
```

Then, and this is the part reviewers actually care about:

**Say what you ran it against.** Several of this project's real bugs typechecked cleanly and passed unit
tests, and only appeared against real data on a real machine — `--verbose` being required for stream-json,
`GIT_ASKPASS` being blocked by simple-git, a 164 KB diff hitting `ENAMETOOLONG`, the shell tool being named
`PowerShell` rather than `Bash`. "Tests pass" is not evidence here.

- Touched the **agent stream**? Exercise it against a live run, not only `docs/stream-sample.jsonl`.
- Touched **git**? Try it on a throwaway repository. **Never** on a repository you care about, and never on
  someone else's client work.
- Touched the **terminal**? Confirm the PTY is gone after the socket closes.
- Touched **anything visual**? Say which theme, accent and density you looked at. Light mode is not optional.
- Used **Flight Deck to edit Flight Deck**? Run `npm run typecheck` before you trust the window you are
  looking at. The dev server does not typecheck — esbuild strips types and serves the file — so a client edit
  that references something undeclared boots fine and then blanks the page with a `ReferenceError`. Working in
  a second checkout avoids the problem entirely.

**Update the docs in the same PR.** [FEATURES.md](./FEATURES.md) for scope, [API.md](./API.md) for routes or
event shapes, [DESIGN.md](./DESIGN.md) for tokens, [DECISIONS.md](./DECISIONS.md) for any judgement call a
future reader would otherwise have to re-derive. DECISIONS is append-only — add an entry, do not rewrite
history.

### PR description

Say what changed, why, and what you ran it against. If it is a bug fix, include the symptom you started
from — verbatim error text is ideal, since Flight Deck shows you the real `git`/`claude` stderr specifically
so it can be pasted.

Screenshots for anything visual. Before and after, if you changed something that already existed.

## The rules that are not negotiable

These are enforced in review, and several have tests that will fail if you break them.

1. **Never hardcode a colour.** Every colour is a token from [DESIGN.md](./DESIGN.md). If the value you need
   does not exist, add the token.
2. **Green and red are semantic only** — added/succeeded and removed/failed. The accent is cyan by default and
   user-configurable. A decorative green anywhere is a bug.
3. **Never `setState` per streamed chunk.** Accumulate in a ref, flush on `requestAnimationFrame`. This is the
   difference between smooth and unusable.
4. **Never "Something went wrong."** Surface the real `git`/`claude` stderr, verbatim, with a copy button.
   Errors carry `{message, detail, code}`. A summary line with no explanation counts as a violation — that
   exact bug shipped once and was fixed.
5. **Git paths resolve server-side from `projectId`.** A path from the client is never passed to `simple-git`
   or a spawn.
6. **The agent never commits, pushes, or switches branches.** It edits the working tree; the human reviews and
   commits. This is the whole safety model. Do not add a route that breaks it.
7. **No new dependency without a reason in the commit message.**
8. **Windows first, never Windows-only.** Always pass argv arrays, never concatenated command strings. Paths
   have backslashes and sometimes spaces. Every platform-specific or machine-specific value belongs in
   `server/platform.ts` — a path literal anywhere else is a bug, because this project must run on a machine
   that looks nothing like the author's.

## Code style

The linter and the type checker cover the mechanical parts. What they cannot check:

- **One component per file**, named export, colocated with nothing else. Hooks in `client/hooks/` or beside
  the feature that owns them.
- **No barrel files.** Import from the module that defines the thing.
- **Types are shared, not duplicated.** UI event and API shapes live in `shared/types.ts`.
- **Comments explain _why_.** The what is in the code. Non-obvious constraints deserve a sentence — the rAF
  batching, the PTY disposal, the `--verbose` requirement, the `--add-dir` grant.
- **Server modules that spawn things** live in `server/agent.ts` and `server/pty.ts`. Nowhere else.
- **Keep functions testable.** Pure logic (parsing, aggregation, ranking) goes in its own module with its own
  test, separate from the component or route that calls it.

## What will be turned down

Not because the idea is bad — because it is not this tool. These are recorded in
[FEATURES.md](./FEATURES.md) and [DECISIONS.md](./DECISIONS.md):

- **Multi-agent orchestration**: an orchestrator, agent-to-agent messaging, routing work between agents.
  One agent per chat; the human decides who does what.
- **Worktrees or per-agent branches.** The working tree is the sandbox and `git diff` is the audit trail.
- **Scheduled or background runs.** Nothing happens unless someone presses something.
- **Remote access, tunnels, phone control, auth, multi-user, deploy.** `localhost`, one machine, one person.
- **An editor.** The diff viewer shows changes; it is not a second VS Code.
- **Next.js, an ORM, a state-management framework, or a component library beyond shadcn.**
- **Smooth-scrolling libraries** (Lenis, Locomotive). They fight virtualisation and native scroll.
- **Per-token text animation, or spring/bounce motion.**

If you think one of these should change, open an issue and argue it there before writing the code.

## Reporting bugs

Include:

1. What you did, and what happened instead.
2. **The verbatim error**, from the copy button in the UI or from the server terminal.
3. Your OS, Node version (`node -v`), and Claude Code version (`claude --version`).
4. Whether it reproduces on a fresh throwaway repository.

A screenshot of the failing panel is worth a paragraph of description.

## Security

Flight Deck runs an unauthenticated server on `127.0.0.1` and spawns processes with the permissions of
whoever started it. If you find something that lets a page or a repository reach further than that — a path
traversal out of a project, a route that accepts a client-supplied filesystem path, a command built by string
concatenation — please report it privately to the maintainer rather than opening a public issue.

## Licence

By contributing you agree that your work is licensed under the [MIT Licence](./LICENSE) that covers this
project.
