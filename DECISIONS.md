# Decisions

Append-only. One entry per call, with the reasoning that produced it. The point is that
neither of us re-litigates a settled question — and that when we *do* revisit one, we
know what we thought at the time.

Format: date · decision · why · what would change it.

---

### 2026-08-18 · Build a local console instead of a multi-agent harness

We first tried an existing multi-agent harness (Munder Difflin): an orchestrator agent
routing work to four per-repo agents in isolated git worktrees. It worked, but the
overhead was all in the parts we did not need — worktree bootstrap, per-agent
`npm ci`, `.env` copying, agent-to-agent routing, and an hourly scheduled mission
spending tokens on nothing. For one developer working on one thing at a time, a single
strong session beat four coordinated ones.

Flight Deck keeps the one thing that was genuinely valuable — many projects in one
window — and drops the orchestration.

*Would change it if:* work regularly needs two agents progressing in parallel for hours
on separate repos.

---

### 2026-08-18 · Agent transport: `claude` CLI headless, not the Agent SDK

`claude -p --output-format stream-json` runs on the existing Claude subscription (OAuth
credentials in `~/.claude/.credentials.json`, `subscriptionType: team`) — no API key, no
per-token billing. The Claude Agent SDK is a nicer typed interface but its auth path was
not verified; if it requires `ANTHROPIC_API_KEY` we would be paying metered rates for
what the CLI gives us free.

Mitigation: all spawning is isolated in `server/agent.ts`, so switching transport is one
file.

*Would change it if:* we need in-UI tool approval (the SDK's `canUseTool` callback), or
the SDK is confirmed to use subscription auth.

---

### 2026-08-18 · No `manual` permission mode in v1

This CLI version (2.1.233) exposes no `--permission-prompt-tool`, so there is no
documented way to answer an interactive approval from our UI in `-p` mode. Shipping a
`manual` option that silently hangs or denies is worse than not offering it.

v1 offers `acceptEdits` (default), `plan`, and `bypassPermissions`.

*Would change it if:* an approval channel appears in the CLI, or we move to the Agent
SDK.

---

### 2026-08-18 · Vite + Fastify, not Next.js

The terminal needs WebSockets, and App Router route handlers cannot do protocol
upgrades without a custom server. Nothing in this tool benefits from SSR or server
components — it is a single-user localhost app. Vite gives faster HMR and no
server/client component semantics to reason about.

*Would change it if:* the terminal were dropped and we wanted Next's conventions.

---

### 2026-08-18 · The agent never commits; the human does

The agent edits the working tree. It does not commit, push, or switch branches. There
are no `push`, `reset --hard`, or `merge` routes.

This one rule removes an entire category of machinery: no worktrees, no `agent/*`
branches, no per-agent dependency installs, no env-file copying. The working tree is the
sandbox, `git diff` is the audit log, `git restore` is the undo. It is also what makes
`acceptEdits` a safe default on live client repos.

*Would change it if:* nothing foreseeable. This is the safety model.

---

### 2026-08-18 · Manual project list, not auto-scan

`E:\muhaz\CStudio` contains ~22 git repos, several nested (`com8_realty/web/*`) and
several disposable (`temp/`, tutorials). An auto-scanner would have to guess which are
real projects and would surface noise on every launch. Adding a project takes one
folder pick.

*Would change it if:* the list grows past the point where adding them by hand is the
annoying part.

---

### 2026-08-18 · Cyan accent, not green

Green was requested, but git assigns green and red fixed meanings — added and removed —
and success/error messages use the same hues. An accent sharing that hue makes every
highlight in the diff viewer ambiguous: is this green because it is an addition or
because it is interactive?

Cyan appears nowhere in a diff or a status message. Green and red stay purely semantic.

*Would change it if:* we abandoned standard diff colors, which would fight every
developer's muscle memory.

---

### 2026-08-18 · Dark only, fully tokenised

One theme ships, but every color is a CSS variable, so a light theme later is a token
swap rather than a component-by-component refactor. Roughly half the styling work of
building both now, with the door left open.

---

### 2026-08-18 · Ubuntu for UI, JetBrains Mono for code

Ubuntu is the requested UI face; self-hosted woff2 (400/500/700) so the app works
offline and a hanging font request cannot block first paint. Its letterforms are wider
than Inter's, so the base size is 13.5px with zero tracking.

Ubuntu Mono was rejected for code: its `0`/`O` and `l`/`1` are insufficiently distinct
at 12.5px, which is the wrong trade in a diff viewer and a terminal.

---

### 2026-08-18 · Store no message history; replay Claude Code's transcript

Claude Code already persists a JSONL transcript per session under
`~/.claude/projects/<encoded-cwd>/`. Duplicating that into our own store would mean two
sources of truth that can disagree. Flight Deck stores only projects, chats, and session
ids; history is rendered from the transcript.

*Would change it if:* the transcript format churns often enough that reading it becomes
a maintenance cost.

---

### 2026-08-18 · No built-in projects directory

The picker reopens wherever you last browsed and falls back to the home directory. There
is no default projects root anywhere in the code, and `server/platform.ts` is the only
module allowed to know anything machine-specific.

The reason is portability: this may be open-sourced, and a hardcoded path that happens to
exist on one machine is both wrong for everyone else and annoying to retrofit later. A
wrong guess in a file picker is worse than an obvious starting point.

*Would change it if:* never. Defaults like this belong in state, owned by the user.

---

### 2026-08-18 · Resolve the `claude` binary instead of spawning `claude`

`spawn('claude')` fails with `ENOENT` on Windows even though `claude` runs fine in a
shell: npm installs the CLI as a `claude.cmd` batch shim, and `CreateProcess` cannot
execute a `.cmd`. Confirmed by the first end-to-end run of this project.

The usual workaround — spawning through `cmd.exe /c` — drags a shell parser into every
launch, which is the class of bug that truncates prompts at newlines and breaks on paths
with spaces. Instead `server/cli.ts` reads the shim, extracts the executable it actually
wraps, and spawns that directly, so no shell is involved. Resolution order is
`CLAUDE_BIN` → a real executable on `PATH` → decoded shim → `cmd.exe` as a last resort.

On this machine the shim pointed at a native
`node_modules/@anthropic-ai/claude-code/bin/claude.exe`; the resolver also handles the
`.js`-target form by spawning it with `process.execPath`.

*Would change it if:* the CLI ships a real `claude.exe` on `PATH` everywhere, at which
point step 2 always wins and the rest is dead code worth deleting.

---

### 2026-08-18 · Origin set to github.com/muhazAhmed/flightdeck

The repository is initialised with `main` as the default branch and that remote
configured. Nothing has been pushed yet — publishing is a deliberate act, and
`docs/stream-sample.jsonl` should be sanitised first (it contains real local paths and the
author's installed tool and skill list).

---

### 2026-08-18 · Inter replaces Ubuntu for UI text

Ubuntu was chosen from a screenshot and rejected after using the actual interface: its
letterforms are wide and soft, which at the 13–14px this tool runs at reads as
indistinct rather than obviously wrong. Inter is drawn for interface sizes.

Both faces are now self-hosted from npm (`@fontsource-variable/inter`,
`@fontsource-variable/jetbrains-mono`) instead of assumed to be installed — which was the
other half of the problem, since neither font existed on the machine and the app was
silently rendering system fallbacks. Base size moved to 14/21 with slight negative
tracking and Inter's `cv05`/`cv08` variants for a distinguishable `1`/`l`/`I`.

*Would change it if:* nothing pending. Changing face is now a two-line edit in
`tokens.css` plus one import.

---

### 2026-08-18 · Our own diff renderer instead of Monaco

SPEC originally called for Monaco's diff editor. Built as a ~120-line parser
(`parseDiff.ts`) plus a renderer instead, because:

- git already gives us unified diff text; Monaco would re-derive what we have.
- We never edit inside the diff — Monaco's value is editing.
- It costs roughly two megabytes and needs its own theme mapped to our tokens; a
  mismatched diff palette looks like a foreign app embedded in ours.
- A pure parser is unit-testable; an embedded editor is not.

The parser is covered by seven tests, including blank-context-line handling (dropping one
would shift every line number after it) and the `\ No newline at end of file` marker.

*Would change it if:* we want side-by-side diffs with inline editing, or syntax
highlighting inside the diff — at which point Monaco earns its size.

---

### 2026-08-18 · `git diff --no-index` for untracked files

An untracked file has no diff at all, so selecting one in the Changes panel would show an
empty pane. The route detects that case and renders the file as one large addition via
`--no-index` against the null device.

One wrinkle worth knowing: `git diff --no-index` exits 1 whenever it finds differences,
and simple-git treats a non-zero exit as a failure — so the payload arrives on the error
rather than as a result, and the route recovers it from there.

---

### 2026-08-18 · Staging is partial, and skips are announced

Found by using the tool: pressing "stage all" in a project containing a nested git
repository failed with `error: 'excellencedriving-prototype/' does not have a commit
checked out: adding files failed`, and **nothing** was staged. `git add` is
all-or-nothing, so one unstageable path sinks the entire batch.

The route now checks each path first, stages everything it can, and returns
`{status, skipped}` where each skip carries a reason in words the user can act on. The
client raises a warning toast per skip — a partial success that looked total would be
worse than the original failure.

Staging a nested repo "successfully" was never an option: it would record a gitlink the
user never asked for.

*Would change it if:* we add deliberate submodule support, which is a different feature
with its own confirmation.

---

### 2026-08-18 · Every source-control action goes through one confirmation dialog

Requested, and worth keeping even where the action is reversible. Stage, unstage, discard,
stash and stash-pop all route through a single `ConfirmDialog` that lists the exact files
involved (capped at twelve plus a count).

The reasoning: the panel's buttons are small icons in dense rows, and a mis-click that
silently rewrites the index is exactly the kind of thing that erodes trust in a tool you
let an agent edit files through. The dialog states the consequence rather than asking "are
you sure" — and it distinguishes reversible ("you can unstage afterwards") from permanent
("this cannot be undone").

Per-file stage and unstage from a row also confirm. If that proves tiresome in daily use,
the fix is to skip the dialog for single-file reversible actions only — not to drop it for
discard.

---

### 2026-08-18 · Push exists, and it belongs to the human

SPEC said "never push". That rule was written about the *agent*, and it still holds — no
agent-reachable path touches `server/routes/remote.ts`. But a person clicking Push in their
own UI is a different act, and withholding it just sends them to a terminal to do the same
thing with less context in front of them.

The narrowing is what makes it safe to offer:

- never `--force`, in any spelling — there is no flag, no parameter, no route that accepts one
- never `--all`; one branch, the one checked out
- remote and branch come from the repository's config, never from the request body
- always behind a confirmation that names the remote, the branch, and the commit count
- pull is `--ff-only` and refuses outright on a dirty tree, because a surprise merge is how
  people lose work

*Would change it if:* nothing. Force-push stays out permanently.

---

### 2026-08-18 · Two bugs found by running the thing

**Transcript path encoding.** `transcriptDirFor` collapsed runs of separators
(`/[\/:]+/`), so `E:\muhaz\flightdeck` encoded as `E-muhaz-flightdeck` while the real
directory is `E--muhaz-flightdeck` — the drive colon and the following backslash are two
characters and therefore two dashes. History replay found nothing and reported no error,
because a missing transcript is legitimately "no history". Fixed to replace each character,
and pinned with tests, since the failure mode is silence.

**Inherited editor variables.** simple-git refuses to run when `GIT_EDITOR`, `EDITOR` or
`VISUAL` is present in the child environment (it could hand git an arbitrary program), and
the server inherits `GIT_EDITOR` from whatever shell launched it. Push failed with
`Use of "EDITOR" is not permitted without enabling allowUnsafeEditor`. Stripped those three
variables for remote operations rather than opting into `allowUnsafeEditor`; none of them
needs an editor.

Both were invisible to typechecking and to unit tests written against fixtures. They only
appeared when the routes ran against a real repository — which is why CLAUDE.md requires it.

---

### 2026-08-18 · Remote and config operations spawn `git` directly

simple-git ships a guard that refuses to run whenever the environment handed to it contains
a variable that could make git execute another program — `GIT_ASKPASS`, `GIT_EDITOR`,
`SSH_ASKPASS` and relatives. Sound protection against untrusted input, but our environment
is simply whatever shell started the server, and VS Code sets `GIT_ASKPASS` as a matter of
course. Push failed with
`Use of "GIT_ASKPASS" is not permitted without enabling allowUnsafeAskPass`, and the opt-out
flags are not in the published typings.

Notably this was invisible in the first round of testing: `routes/git.ts` never passes a
custom env, so no guard runs there, while `routes/remote.ts` did — status worked and push
did not, from the same library.

`server/git-exec.ts` now spawns `git` with an argv array and an environment we build
ourselves: the program-executing variables are stripped, `GIT_TERMINAL_PROMPT=0` so a
prompt fails fast instead of hanging, and `LC_ALL=C` so output is parseable regardless of
locale. Git's own credential helpers live in git config rather than the environment, so real
pushes still authenticate.

simple-git stays for reads and staging, where it saves genuine parsing work and is never
handed a custom env.

Status for these routes is read with `git status --porcelain=v2 --branch`, parsed in
`routes/status.ts` — the branch, upstream and ahead/behind counts arrive in one call, and the
format is the one git promises not to change. Nine tests cover it, including a rename line
(whose field count differs by one from an ordinary change — caught by a failing test).

---

### 2026-08-18 · Identity is switched per repository, never globally

One machine, several clients: personal commits under one name, company work under another.
The manual routine is `git config user.name` / `user.email` in the right repo before the
first commit, which people remember exactly once — after the wrong name is already in the
history.

Flight Deck already knows which project you are committing to, so the identity in force is
shown directly above the commit box, with a one-click switcher and a saved list. Two rules
make it safe:

- **Writes are `--local` only.** A switcher that edited the global default would change every
  repository on the machine, which is the opposite of the point.
- **`scope` is displayed, not hidden.** `global` means this repository has no opinion and is
  inheriting the machine default — precisely the state that produces a wrong attribution, so
  it is labelled rather than smoothed over.

Removing a saved identity never alters any repository's config; it only forgets a shortcut.

---

### 2026-08-18 · Ubuntu, after all — and what the original complaint actually was

Reverting the switch to Inter at the user's request. Worth recording honestly, because the
first diagnosis was half wrong.

When the interface read as "not easy to read", there were two candidate causes: neither font
was installed on the machine (so everything rendered as Segoe UI and Consolas), and Ubuntu
softens at 13–14px. Both were plausible; I fixed the first and *also* changed the face on the
strength of the second. The first was the real problem — with Ubuntu genuinely loaded at
14/21, it is fine, and the face is the user's call to make.

What carried over from the Inter round and stays:

- self-hosted from npm rather than the Google Fonts CDN, so the app works offline and a
  stalled font request cannot block first paint
- 14px/21px rather than the original 13.5/20
- `letter-spacing: 0` — Ubuntu is already wide, and the negative tracking that suited Inter
  makes Ubuntu muddier
- JetBrains Mono for anything where `1`/`l`/`I` must be distinguishable, since Ubuntu offers
  no disambiguation variants

Changing face is now a two-line edit: `--font-ui` in `tokens.css` and the import in
`index.css`. Nothing else names a font.

*Lesson worth keeping:* when two explanations fit, fix the one you can verify first and let
the user judge the subjective one. Changing both at once made it unclear which had helped.
