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

The author’s projects folder contains ~22 git repos, several nested (`parent/web/*`) and
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
(`/[\/:]+/`), so `C:\repos\app` encoded as `C-repos-app` while the real
directory is `C--repos-app` — the drive colon and the following backslash are two
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

---

### 2026-08-18 · Branch operations, and where the guard belongs

Checkout, create, delete — human-initiated like commit and push, and nothing agent-reachable
touches them. The asymmetry between them is deliberate:

- **Checkout refuses on a dirty tree.** git would happily carry uncommitted edits onto the
  other branch, which is precisely how work ends up committed to the wrong one. Refused with
  the reason; stash is one button away.
- **Create carries the working tree**, on purpose. "This shouldn't be on main" is a thought
  people have mid-edit, and `checkout -b` bringing the changes along is the whole point.
- **Delete uses `-d`**, so git refuses a branch whose commits exist nowhere else. That refusal
  surfaces as a second, explicit force-delete confirmation rather than a silent retry.
- **A remote branch checks out with `--track`.** Plain `checkout origin/x` would leave a
  detached HEAD — a state most people cannot get out of without help.

**A bug caught by testing against a real repository:** local and remote were separated by the
*short* refname, but `%(refname:short)` renders a remote branch as `origin/main`, which is
shape-identical to a local branch containing a slash. `origin/main` therefore appeared in the
local list and would have been offered as a direct checkout — detaching HEAD. The format now
requests both `%(refname)` and `%(refname:short)`; the full one classifies, the short one is
displayed. Pinned with a test whose name says what it prevents.

Also worth recording: an expectation of mine was wrong during that testing. Deleting a branch
I assumed was unmerged succeeded, because its commits were reachable from another branch I had
created off it. git was right; the test was written from a mistaken mental model.

---

### 2026-08-18 · Sessions started elsewhere can be imported

Claude Code writes one JSONL transcript per session under
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` regardless of who started it — this app,
the IDE extension, or a bare terminal. History replay already reads that format, so adopting a
foreign session costs almost nothing: record its id as a chat and its transcript renders like
any other.

Verified against the session that built this project: 6 MB transcript, 38 prompts, 318 tool
calls, replayed in 142 ms into a 1 MB payload.

**This does not tie the project to one machine.** The location comes from `homedir()` plus the
project's own path, so anyone who clones Flight Deck gets the feature over their own sessions.
The directory layout is undocumented (read off disk), so a CLI change degrades it to "no
sessions found" rather than breaking anything.

**The limitation is stated, not hidden.** Two clients cannot safely write to one session id.
A transcript touched in the last three minutes is flagged as probably open elsewhere: importing
and reading it is safe, sending a message while it is live elsewhere is not. That is a
heuristic on file mtime — there is no liveness signal to consult — and it is labelled as one.

Importing sets `lastMessageAt` from the file's mtime, which makes the next message use
`--resume` instead of trying to claim an id the CLI already knows.

*Known rough edge:* a transcript this size renders ~800 blocks, and the chat list is not
virtualised yet. Collapsed tool cards keep it cheap, but a very long session is the case that
will eventually need `@tanstack/react-virtual` as DESIGN.md already prescribes.

---

### 2026-08-18 · Following the mockup, selectively

A reference design was supplied. What was adopted, and what was not, on purpose:

**Taken.** Staged / Unstaged as tabs with counts — stacked groups made a long changed-list push
staged files off-screen, and the tab bar states both counts at a glance. Two-line project rows,
because a repo's path is what distinguishes `storefront` from `acme-server`. Project
search. A model picker in the chat header. A sidebar footer with the git identity. A real empty
state with suggestion cards. Larger type: 14.5/22, with secondary text at 12.5–13px.

**Declined.** The violet accent (ours stays cyan — see the diff-colour entry). The theme
dropdown, at the user's instruction. The "AI Commit Assistant · Learn more" promo card, which is
marketing furniture in a single-user local tool.

**Corrected.** The mockup's model label read "Claude 3.5 Sonnet", which is long superseded. The
picker offers Opus 5, Sonnet 5 and Haiku 4.5 by full id, plus "Default" meaning whatever the CLI
is configured for. A pinned id is passed as `--model`; verified end to end — pinning Haiku had
the session handshake report `claude-haiku-4-5` back.

**Suggestion cards are real prompts, not topics.** Each fills the input with an instruction the
agent can act on ("read the staged diff and write a commit message… do not run git commit") and
leaves it editable rather than sending it. A card that types a subject line and stops makes the
user do the work twice.

**Unbuilt UI is disabled, not absent and not fake.** The settings buttons in the sidebar footer,
the chat header and the Changes header all render greyed with a "not built yet" tooltip. Showing
where something will live is honest; a button that opens an empty page is not.

---

### 2026-08-18 · Drafted commit messages, and why they never commit

A sparkle button in the message box reads `git diff --staged` and writes a message. The design
constraints matter more than the feature:

- **It fills the box, it does not commit.** This is the one place in the app where a model writes
  something that lands permanently in history. A human reads it first, every time. Replacing text
  you already typed asks for confirmation.
- **The diff is sent inline, and write tools are denied** (`--disallowedTools Edit Write
  NotebookEdit Bash Task`, `--max-turns 1`). The prompt contains everything needed to answer, so
  a tool call would mean the model doing something nobody asked for.
- **Truncation is disclosed twice** — to the model ("do not claim it is complete") and to the user
  as a warning toast. A 60k-character cap keeps a megabyte refactor from being pointless to send;
  a silently shortened diff would produce a confidently wrong message.
- **It runs in the project directory**, so the repository's own `CLAUDE.md` and recent history can
  shape the style (Conventional Commits, for instance) without us hardcoding a convention.
- Fenced output is stripped. Models occasionally wrap the answer in backticks despite being told
  not to, and backticks in a commit subject are worse than an extra guard.

Verified on a real staged diff: subject `Issue unique expiring session tokens on login` (45
chars), with a body explaining that the previous static token was forgeable — the *why*, not a
restatement of the diff.

**A bug found while verifying:** the reported model was always null. The CLI's JSON result has no
top-level `model` field — the model is a KEY of `modelUsage` (`"claude-opus-5[1m]"`). Reading a
field that does not exist made the UI quietly claim it did not know, which is the kind of small
lie that erodes trust in everything else on screen.

**Cost, stated honestly:** each draft is a fresh one-shot session, so it pays full prompt-cache
creation — around $0.26–0.34 of *notional* cost, and a real bite out of a rate-limit window even
though a subscription is not billed per token. The route accepts a `model`, so pinning Haiku for
drafts is a one-line change if the default proves too expensive in practice.

---

### 2026-08-18 · The prompt goes on stdin, never on argv

Commit-message drafting returned a 500 the first time it met a real repository. Cause: the prompt
was passed as a command-line argument, and Windows caps a command line at ~32,767 characters. The
staged diff in this project was **164,385 characters**; even against the original 60k cap the
prompt sailed past the limit and `spawn` failed with `ENAMETOOLONG` before the model was ever
reached.

Reproduced directly — a 40k argv prompt fails with `ENAMETOOLONG`, an 80k prompt on **stdin**
succeeds. `claude -p` with no prompt argument reads from stdin, which has no such limit, so the
prompt now goes there and the cap rose to 120k characters (kept only because context costs money,
not because of any platform limit).

Verified on the exact input that failed: 164k staged diff, 11 seconds, an accurate message
describing branch management, session import and the drafting feature itself, correctly flagged as
`truncated`.

**Why my own testing missed it.** I verified against a purpose-built scratch repo whose staged diff
was about a kilobyte. The failure needed a *realistic* diff, and a small fixture cannot produce
one. Pinned now by a test that asserts the prompt never appears in argv at all, rather than
asserting anything about size — the size is incidental, putting content on a command line is the
actual mistake.

This is the same class of error as the earlier `--verbose` and `GIT_ASKPASS` bugs: everything
typechecked, the unit tests passed, and the defect only appeared when the code met real data on a
real machine.

---

### 2026-08-18 · Off near-black, and onto Geist

Two changes at the user's judgement, after seeing the built UI.

**The background was too dark.** `#0A0A0B` read as a dead void: panel edges disappeared into it and
the app looked switched off rather than dark. The surface stack is now lifted into slate with a
slight blue cast — `#101319` / `#161A22` / `#1C212B` / `#242A36` — where each step is a visible
increment, so a card on a panel on the app background reads as three planes without a single
shadow. Diff tints went from 12% to 16% and the gutter colours brightened, because a lifted
background needs more of both before a changed row reads as changed.

Every text pair is measured rather than judged: primary 14.6:1, secondary 7.7:1, muted 3.9:1,
accent-on-fill 7.5:1. A small script checked the whole palette and all eleven pairs cleared their
floor.

**Third font, and the last one I pick blind.** Inter was tried, then Ubuntu at the user's request,
and both were rejected in use. Geist is now the default — drawn for interfaces, holds its shape at
14px where a humanist face softens, and its even widths suit a dense three-panel layout. Base type
moved to 14/22 with `-0.003em` tracking.

The useful part is that **switching no longer requires me**. Two UI faces ship loaded (Geist and
Plus Jakarta Sans), so changing `--font-ui` in `tokens.css` is the entire operation — no install,
no rebuild of anything but the stylesheet. Nothing else in the codebase names a font. When the
settings page exists, this becomes a dropdown; until then it is one line, and the user can try both
without asking.

*Pattern worth noting:* this is the second time a subjective call has cost a round trip. Loading
alternatives up front so the user can flip between them is cheaper than being right first time.

---

### 2026-08-18 · Collapsing the sidebar left a dead gap

Collapsing the sidebar produced a large empty region where it used to be, with the icon rail
floating oddly beside it. Two mistakes, both from the same misunderstanding:

1. The sidebar `Panel` was hidden with Tailwind's `hidden` class. `react-resizable-panels` owns
   the layout of its children and writes `display` and `flex` **inline** — inline styles beat
   classes, so the panel kept its width and the class did nothing visible.
2. The collapsed icon rail was rendered as a **direct child of `Group`**, which positions Panels
   and Separators only. Anything else is left unplaced.

Fixed by taking the rail out of the group entirely: it is now a plain flex sibling, and `Group`
holds only real panels, with the sidebar `Panel` conditionally rendered rather than hidden.

Pinned with a source-level test rather than a rendered one — there is no DOM in this runner, and
the invariant that regressed is structural: no `Panel` may carry a `className`, and nothing but
`Panel`/`Separator` may sit directly inside `Group`. A rendering test would have been slower to
write and no more likely to catch the next instance of the same mistake.

Also noticed in the same screenshot: both the chat and the Changes panel said "No project
selected", three inches apart. The Changes panel now says "Nothing to review — select a project to
see its changes."

---

### 2026-08-18 · Attachments are paths, not uploads

The CLI's `--file` flag takes cloud file ids, not local paths, and there is no local attachment
channel. What the agent *does* have is a `Read` tool that reads text files and images from disk. So
an attachment here means "put the file on disk and give the agent its path".

- **Paste, drop, or pick.** A pasted screenshot is the common case and the one with no file to
  choose, so the paste handler comes first; drag-and-drop and a paperclip picker cover the rest.
- **Bytes are copied to `~/.flightdeck/attachments/<date>/`** because a browser never reveals where
  a dropped file came from — it hands over bytes and a name, never a path. Grouped by day so the
  folder stays browsable.
- **The prompt gets the path, not the contents.** Appended as an explicit "Attached files:" block.
  The agent reads what it needs, nothing is truncated, and a 2 MB screenshot never becomes 2 MB of
  context. The UI notes that for files already in the project, typing the repo path is cheaper than
  attaching a copy.
- **Names are sanitised, and the test says why.** `../../etc/passwd` becomes `..-..-etc-passwd`; the
  uuid prefix handles uniqueness so the name only has to be legible. Six tests cover traversal,
  hostile characters, names that sanitise to nothing, and truncation.
- **The size cap is checked twice.** base64 inflates a body by a third, so a 6 MB file trips
  Fastify's 8 MB body limit *before* the route can explain itself — the user would see a bare
  "413 Payload Too Large". The client now rejects oversized files up front with a real sentence, and
  a test asserts the cap still fits inside the body limit.

### Count badges

The count chips beside "Changes", "Staged" and "Unstaged" had backgrounds that were invisible:
`--surface-3` on a `--surface-2` tab bar is a 1.1:1 luminance difference. Adjacent dark surfaces
simply cannot carry a small element on fill alone — **borders are the tool that works at these
levels**, so chips and the active tab now carry a 1px border plus fill, and the tab bar is inset to
`--bg-base` so the active tab reads as lifted. Worth remembering the next time something dark
"looks flat": reach for a border, not another surface step.

---

### 2026-08-18 · One accent value could not do two opposite jobs

Buttons were unreadable: white-ish text on a bright cyan fill. The cause was using a single
`--accent` for two requirements that pull in opposite directions — a **fill** must be dark enough
for the label on top of it, while a **mark on a dark surface** (icon, link, focus ring) must be
bright enough to stand off the panel.

Now split: `--accent` is `#0E7490`, which carries white at 5.4:1 (the old `#06B6D4` gave 2.4:1 and
failed outright), and `--accent-bright` stays `#22D3EE` for marks, at 9.6:1 against a panel. Hover
is `#10809E`, chosen because it still holds white at 4.6:1 — brightening on hover is only worth
doing while the label stays readable.

**Count badges took three attempts, and the lesson is the same each time.** Surface-on-surface
(`--surface-3` on `--surface-2`) is a 1.1:1 difference and reads as nothing; adding a border helped
a little; what actually works is a filled accent chip with a white label. Adjacent dark surfaces
cannot distinguish a small element on fill alone — use a fill that is a different *hue*, or a
border, not another step of the same grey. A zero count keeps the neutral bordered chip, since a
filled badge is a call to attention and zero has nothing to attend to.

All six affected pairs were measured after the change rather than eyeballed.

---

### 2026-08-18 · Clicking a project opens a chat

"No chat open for flightdeck" was a dead end: every project click cost a second click for a
decision nobody wanted to make. Selecting a project now opens its most recently used chat (by
`lastMessageAt`, falling back to `createdAt`), and creates a fresh one when the project has none.

Guarded with a ref keyed on the project id, so a failed creation cannot loop the effect. Deleting a
chat deliberately does *not* auto-create a replacement — that would fight a user who is tidying up,
and the panel still offers a New chat button.

---

### 2026-08-18 · Markdown in the transcript

The agent writes markdown and the transcript printed it literally: `##` and `**` on screen, side by
side with the IDE extension rendering the same text properly. `react-markdown` + `remark-gfm` now
render it, with every element mapped to a design token — browser defaults would have supplied white
headings, blue links and serif blockquotes.

Three decisions inside it:

- **Headings stay close to body size** (17 / 16 / 14.5 / 14px against 14px prose). This is chat, not
  a document; an h1 that dwarfs its surroundings breaks the reading rhythm.
- **Your own messages are not rendered as markdown.** What you typed is what you see — reformatting
  a user's own words back at them is disorienting, and prompts frequently contain markdown-ish
  punctuation that was never meant as markup.
- **Memoised per text block.** While a response streams, only the final block re-parses on each
  animation frame; everything above it is untouched. Without that, a long conversation re-parses
  itself sixty times a second.

Cost: the bundle went 477 kB → 637 kB (195 kB gzipped). Acceptable for a tool served from
localhost; if it ever matters, the renderer is one dynamic import away from being lazy.

**Verified by rendering, not by inspection.** Eight tests run the component through
`react-dom/server` and assert the syntax is *consumed* — no `##`, no `**`, no backticks in the
output — plus tables, strikethrough, `target="_blank"` with `noopener`, and that every element
carries a class rather than falling back to browser styling.

Two incidental fixes this needed: `test/` was missing from `tsconfig.json`'s `include`, so esbuild
compiled JSX with the classic runtime (`React is not defined`) and the test files were never
type-checked at all. Both are fixed, which means the whole suite is now covered by `tsc` too.

---

### 2026-08-18 · Settings: themes, accents, and what a preference is allowed to turn off

A real settings page, its own left nav, with every planned section listed and the unbuilt ones
visibly disabled — same rule as the placeholder gear before it: showing where a thing will live is
honest, a button to an empty page is not.

**Preferences live on the server**, in `state.json` beside projects. Browser storage would mean a
setting that silently differs between a reload and a second tab, which is worse than no setting.
Every field is validated against its allowed values, because an unknown accent name would reach the
DOM as a `data-accent` attribute matching no CSS rule — leaving the app on the default colour with
nothing to explain why.

**Appearance is applied by attributes on `<html>`**, not by re-rendering: `data-theme`,
`data-accent`, `data-density`, plus `color-scheme` so the browser styles form controls and
scrollbars to match. A colour change is one attribute write and a repaint; no component knows the
theme changed.

**Every accent is a measured pair, not a swatch.** A fill has to carry white text (≥4.5:1) and a
bright variant has to stand off a panel (≥4.5:1) — one hex cannot do both, as the earlier
unreadable-button bug proved. All seven were computed before being offered. Two consequences worth
recording: green's hover goes *darker* rather than lighter, because every lighter green drops white
below 4.5:1; and each accent needs a light-theme companion, since a bright mark on white is
invisible. Green, amber and red are offered with a note that they share a hue with diff additions,
warnings and errors respectively — the user's call, made with the trade-off visible.

**Density touches the type scale only.** Spacing lives in Tailwind utility classes across dozens of
components; driving it from a variable would mean rewriting all of them for one preference. The
setting says so rather than implying more than it does.

**One preference deliberately cannot be turned off.** "Confirm source-control actions" offers *every
action* or *only destructive*, and discard, force-delete and overwriting a typed commit message
always ask regardless of the setting. A switch that removes the guard on unrecoverable operations is
not a preference, it is a trap.

**A test keeps the CSS and the UI in sync**: every offered accent must have a rule, every rule must
be offered, each must redefine the whole variable set (a rule that sets the fill but not
`--accent-bright` leaves icons the previous colour), the light theme must redefine every surface, and
density must not pretend to change spacing.

*Method note:* my first version of that test built its regex by interpolating into a template
literal, which the tooling mangled into a pattern matching nothing — a test that matches nothing
passes for the wrong reason. Rewritten as a plain scan.

---

### 2026-08-18 · Appearance and behaviour are one General section

Splitting them put two clicks between a user and one page of preferences. Both answer the same
question — how the app works for me — so they are two cards under General, and the nav lists only
sections that are genuinely different concerns (git defaults, agent defaults, terminal, shortcuts,
privacy), all still disabled.

Added a render test for the page while making the change: it goes through `react-dom/server` and
asserts Behaviour appears exactly once (a second occurrence would mean it is a nav item again), that
the unbuilt sections still render disabled, that every swatch carries an `aria-label`, that the
selected accent reports `aria-pressed`, and that the startup toggle exposes `aria-checked`.

That test immediately caught something typechecking cannot: `IconButton` uses a Radix tooltip, which
throws outside a `TooltipProvider`. The app has one at its root so nothing was broken, but any future
component rendered outside that provider will fail the same way — worth knowing.

---

### 2026-08-18 · Settings is a view, not a neighbour

The settings page rendered *beside* the workspace instead of replacing it: a sliver of the Changes
panel stayed visible at the right edge, squeezed to a few pixels. Cause: only the sidebar was
guarded by `settingsOpen`, so `Group` still claimed its share of the row.

Now the two are branches of one ternary — settings or workspace, never both — and the settings root
carries `flex-1` so it fills what it is given rather than sizing to content.

Pinned by extending the layout test, and I checked the new assertion actually fails against the old
shape rather than trusting that it would: the buggy source (settings and `Group` as siblings) does not
match the exclusive-ternary pattern the test requires.

That is the second layout bug in this file from the same root cause — assuming a conditional guards
more than it does. Both were invisible to typechecking and to every rendering-free test, which is
why the shell now has structural assertions rather than none.

---

### 2026-08-18 · The switch knob needed an anchor, not a bigger number

The toggle's knob hung off the right edge of its track. The knob was `absolute top-0.5` with **no
`left`**, so its horizontal base was its *static position* — and inside a `<button>`, which centres
its content, that base is the middle of the track. The translate then moved it 22px right of centre
instead of 22px from the left edge.

Fixed by anchoring (`left-0.5`) and moving it by exactly its own travel: track 44 − knob 20 − 2 − 2
= 20px, which is `translate-x-5`. The geometry is now derivable from the classes instead of being a
magic pixel value that happened to look right in one place.

Two tests pin it: the knob must carry a `left` anchor, and the travel must be a scale value rather
than an arbitrary `translate-x-[…]` — an arbitrary number is the shape of a value tuned until it
looked correct, which is what produced the bug.

---

### 2026-08-18 · Four UX corrections in the sidebar and Changes panel

**The profile row is the button.** A 28px gear in the corner of a 44px row was a needlessly small
target for the most-used control in the footer. The whole row now opens settings, with the gear kept
as decoration *inside* the button — a nested button would be invalid markup and would swallow the
outer click.

**Selection is a fill plus an edge.** `bg-accent-subtle` alone is a 14% tint over a panel of the same
family, which is hard to spot at a glance; the selected project now also carries a 2px accent bar on
its left edge. Every row reserves that slot with `border-l-2 border-transparent`, so selecting
nothing does not shift the layout.

**The avatar is legible.** 36px with an accent fill and white text at 14px, matching the count
badges, instead of a faint 28px circle with 11.5px accent text.

**Remote actions are labelled buttons, not three arrows.** Fetch, pull and push as icon + word +
count, in a three-column row. Three unexplained arrows in a corner is a guessing game — up and down
could equally mean push/pull, expand/collapse, or sort — and "which arrow was push?" is not a
question a tool should ask someone twice a day. Each carries a sentence in its title explaining what
it does, and a non-zero count makes the button accent-bordered so "there is something to send" is
visible without reading.

**Testing note worth keeping:** the render test for selection could not drive the store. Zustand v5
passes `getInitialState` as its `useSyncExternalStore` server snapshot, so `setState` is ignored
during `renderToStaticMarkup`. Rather than reshape the component to suit a test, the rendered
assertion checks the marker slot exists and the branch itself is asserted from source — with the
reason written next to it, so the next person does not spend the same twenty minutes.


---

### 2026-08-18 · Marks and fills are separate tokens

Colouring the count badges by meaning exposed the same trap as the accent did: `--success`,
`--warn` and `--info` are **marks** — bright, for icons and text on a dark surface — and white on
bright green is about 2.3:1. Unreadable.

So there are now four `--fill-*` tokens alongside them, dark enough to carry a white label:
success `#15803D` (5.0:1), warn `#A16207` (4.9:1), info `#6D28D9` (7.1:1), danger `#B91C1C`
(6.5:1), all holding in both themes. A test asserts badges use a `--fill-*` token and never a mark
colour, because the failure is silent — the badge still renders, it just cannot be read.

Tones assigned by what is being counted rather than at random: accent for totals and remote
actions, success for staged (ready), warn for changed (in progress), info for stashes (set aside).

**The badge was also not a circle.** `min-w-5 px-1.5` gives a single digit horizontal padding and no
matching vertical padding, which is an oval. `size-5` fixes both axes; past 99 it widens into a pill,
since a circle big enough for three digits would be a blob everywhere else.

---

### 2026-08-18 · Branch and identity sit together, and the gear is gone

The disabled settings gear in the Changes header opened nothing and occupied the corner where a real
control belongs. Removed — the sidebar footer already reaches settings.

In its place, branch and identity are two buttons in one row above the remote actions, styled exactly
like Fetch / Pull / Push so the whole header reads as one family instead of one dropdown, one bar and
three icons. They belong together because they answer the same question — *which context am I
committing into* — and the identity was previously buried above the commit box, visible only after
scrolling a long file list.

---

### 2026-08-18 · The terminal, and where it lives

`node-pty` on the server, `xterm.js` in the browser, one WebSocket per shell, opened in the selected
project's folder.

**It sits at the bottom of the centre column, not across the window.** A nested vertical panel group
inside the chat column, drag-resizable, `Ctrl+J`, with an entry in the sidebar above the profile. The
point of a terminal here is running a build and watching the file list react to it, so the Changes
panel has to stay visible.

**It is yours, not the agent's.** Nothing agent-reachable touches `server/pty.ts`. The agent runs
commands through its own Bash tool and they appear as tool cards. A wedged shell cannot affect a run,
and a run cannot type into your shell.

**Disposal was the real work.** A PTY is an OS process: a closed tab, a reload, or a dropped
connection leaves a shell running against a repository with nobody attached. `close` and `error` both
dispose, shutdown walks the map, and starting a session with an id already in use disposes the
previous one. Verified rather than assumed — two terminals opened, both sockets `terminate()`d with no
close handshake, and the shell count returned to its baseline.

**Reconnecting starts a fresh shell.** A PTY holds no replayable history, so "resuming" would show an
empty screen mid-session and imply state that does not exist.

**Loaded on demand.** xterm plus the WebGL addon is ~450 kB, and the terminal is opt-in — most
sessions never open one. It is a lazy chunk, which brought the main bundle back from 1.10 MB to
654 kB.

**PowerShell before cmd** on Windows, with `FLIGHTDECK_SHELL` as the override. `COMSPEC` is cmd.exe,
which makes a poor first impression in a tool aimed at people who type `git` all day.

Two things worth knowing for anyone touching this:

- **`node-pty` needed no compiler.** It installed from prebuilds and loaded under plain Node first
  try. The electron-rebuild disaster that started this whole project was Electron's ABI, not node-pty.
- **`AttachConsole failed` appears in the server log** when a PTY is killed after its console has
  already gone. It comes from node-pty's forked console-enumeration helper, not from our process — the
  server stays up and serving (checked: still answering 200 afterwards). Worth recognising rather than
  chasing; in an Electron host the same throw used to cascade into a whole-app crash.

## Terminal profiles are detected, not configured

A picker that lists shells the machine does not have is worse than no picker: every wrong entry is a
terminal that opens and dies. So `server/shells.ts` probes — `existsSync` for each candidate, `git` on
PATH to locate Git Bash (on one machine that was `D:/tools/Git/bin/bash.exe`, nowhere near
Program Files), and `wsl.exe` itself for the distro list. Whatever fails its probe is not offered.

`wsl --list --quiet` writes **UTF-16LE**. Read as UTF-8 it produces NUL-interleaved names — a bug that
would satisfy "returns an array of strings" and then fail at spawn, so the test asserts the decode
call rather than the result.

The chosen profile lives in `settings.terminalShell` because a shell preference is a preference, not a
per-session mood; an id that no longer resolves falls back to the detected default rather than
erroring. `defaultShell()` left `platform.ts` entirely — two places deciding which shell to open is
one too many.

Switching restarts the shell, and the menu says so. A PTY's program is fixed at spawn, and reusing the
xterm instance would leave the old shell's output sitting above a new prompt: one broken session
rather than two clean ones.

Verified by opening a real socket per profile and running a command through it. PowerShell, cmd and
Git Bash worked. WSL reported `ready`, then Ubuntu failed to mount with `E_ACCESSDENIED` — which is
the honest outcome: detection can prove WSL is installed, not that a distro will start, and the real
error reaches the user verbatim. Another entry in the running theme that the interesting failures only
appear against a real machine.

## The Changes panel refreshes from the stream, not from a watcher

Watching the file list react while the agent edits is most of the reason the two panels sit side by
side, and until now the panel only refreshed when a run *ended*.

The trigger is the agent stream itself: a `tool_result` for a writing tool bumps the same
`gitRevision` that a finished run bumps. No `fs.watch`, no polling — a watcher on ~20 repos would fire
on `node_modules`, `.git`, and every build artefact, and would need debouncing anyway. The events we
already have say precisely when something was written.

Three details that each would have been a bug:

**`tool_result` carries no tool name.** Only `tool_start` does; results correlate by id. Matching on
`event.name` inside the `tool_result` branch typechecks against the union and then matches nothing —
"a test that passes for the wrong reason" territory, so the writer ids are remembered at `tool_start`.

**The shell tool is not called `Bash` everywhere.** A real handshake on this machine advertised
`Task, Edit, Glob, Grep, NotebookEdit, PowerShell, Read, Skill, WebFetch, WebSearch, Write` — and no
`Bash` at all. A `Bash`-only writer set silently skipped a refresh after every shell command on
Windows. Found by running it against a scratch repo; no unit test would have. Unknown names (MCP
tools) count as read-only: the run ending always refreshes, so an unrecognised writer costs a delay,
never a miss.

**A refresh nobody asked for must look like nothing.** `refresh({quiet: true})` does not raise
`loading` (which spins the Fetch button and reads as network work), does not replace a working panel
with an error banner when a background read fails, and is skipped entirely while a mutation is in
flight — adopting a status read that raced a stage or a commit would show the wrong list. Nothing is
lost by skipping, because the run ending refreshes again.

Debounced at 700ms with a **4s ceiling**. The ceiling is the part worth keeping: a plain trailing
debounce fed an edit every 300ms would never fire once, and a long run would sit still through the
whole thing. Verified against a real run — Edit, Write and PowerShell each triggered a refresh; two
Reads did not.

## No setting that does not do something

The settings page shipped with five disabled nav entries — honest while the pages were empty, but the
temptation when filling them is to add plausible-looking switches. Every field added here drives real
behaviour, and the ones that could not were written as *statements* instead of controls: scrollback
says "fixed at 5000 lines", large diffs say "truncated with a warning", pull says
`--ff-only` with no toggle beside it. A card titled "Fixed by design" is more useful than a disabled
switch, and far more useful than a working switch that changes nothing.

Three choices worth recording:

**Font size mutates the live xterm instance.** Putting `appearance` in the creation effect's
dependencies would dispose the terminal on every press of the stepper — and the server kills the shell
when its socket closes, so nudging the font size would end a running build. The value is read through
a ref at creation and applied by a second effect that also re-fits, since cell metrics changed.

**Sign-off goes through `git commit --signoff`, not through the message text.** Appending the trailer
ourselves would mean composing it from an identity we looked up, which can disagree with the author
line git actually writes. Verified on a scratch repo: the trailer matched the repo-local identity, not
the machine default.

**Model ids are validated against `MODEL_OPTIONS`.** A free-text field would let a typo reach the CLI
as `--model claude-opus-6`, failing once per run with an error that reads like a Flight Deck bug.

The turn cap is the one setting with teeth: `--max-turns` ends a runaway loop instead of spending an
afternoon of quota. 0 omits the flag entirely — `--max-turns 0` would end every run before it started.
All new defaults are the inert value, so updating cannot silently change how anyone's runs behave.

The Privacy section names paths and counts rather than describing them, because "attachments are stored
locally" is a claim while `~/.flightdeck/attachments · 14 files · 8.2 MB` with a delete button is a fact.
The purge builds its directory from `stateDir()` server-side; the client cannot name it, which is the
whole safety of a recursive delete.

## The build trigger runs server-side, not in the shell

The request was a button that runs `git commit --allow-empty -m "trigger build"` and `git push`. It sits
where it was asked for — the terminal header, beside Clear — but it does not type into the terminal.
Three reasons, worst first:

1. `git commit ... && git push` is **invalid in Windows PowerShell 5.1**, the default shell on this
   platform. The chained form would half-run and read as a Flight Deck bug.
2. Typed input goes to whatever the shell is currently running. Press it during a build and the text
   lands in that process.
3. There is already one audited push path. A second one built as a string is exactly what should not
   exist.

The cost is that output arrives as a toast rather than in the terminal, so the toast carries git's own
summary verbatim.

**`--allow-empty` is not "commit nothing".** It commits whatever is in the index — so with files staged,
this button would ship them under the message "trigger build". A staged index is refused and the
refusal names the files. Unstaged and untracked files are fine and were verified to stay put.

**A failed push after a successful commit says so.** Reporting only "could not push" would leave the
user unsure whether anything happened, and pressing the button again stacks empty commits. The error
names the commit, the branch it is on, and `git reset --hard HEAD~1`.

Verified against a bare upstream and a real clone rather than a mock: the commit arrived in the
upstream log, the staged guard held, the empty commit was genuinely empty, and moving the upstream away
produced the exact partial-failure message above.

## A checkout fetches afterwards

Ahead/behind is only meaningful against an up-to-date remote ref, and the counts right after a switch
were as stale as the last fetch — which is how you push on top of something you never saw. Demonstrated
on a scratch clone: immediately after switching to a branch a colleague had pushed to, the panel said
`behind: 0`; the fetch made it `behind: 1`.

It runs **after** the switch, not as part of it: the checkout is already done and reported, so an
unreachable remote delays a number rather than the branch change. A failure is therefore a warning, not
an error — the thing you asked for worked. It has its own `fetching` flag rather than sharing `busy`,
because a slow network must not disable the menu you just used, and the branch chip shows a spinner so
the wait is visible.

## The deck, and what actually differentiates this tool

Fair question from the user: everything built so far is VS Code in a browser tab. True, and the reason is
that every feature until now used the architecture to be *equivalent* to an editor rather than to do
something an editor cannot.

The structural difference is not the diff viewer or the chat. It is that **one process already holds all
twenty repositories.** An editor window knows about one workspace, so "which of my repos have
uncommitted work, and how long has it been sitting?" is a question answered by opening twenty windows.
That makes any cross-repository view the real differentiator, and the deck is the cheapest one with the
highest hit rate — you look at it every time you open the app.

Choices that matter:

**`dirtySince` is the OLDEST changed file, not the newest.** Newest is when you last saved, which you
already know. Oldest is "this has been sitting since Tuesday", which is the thing you forget. Confirmed
useful immediately: on the author's real machine the deck surfaced `prototype` with a change a day old,
above the repository they were actively working in.

**Ranked, not alphabetical.** A deck of twenty equal cards is a list, not an answer. Missing folders
outrank everything (nothing else on the card can be trusted), then stale dirty work, then unpushed
commits, then work in progress, then being behind. Alphabetical order carries no information; recency is
the tie-break, because among clean repositories the one you were in an hour ago is the one you are coming
back to.

**Fetch-all is a button, not automatic.** Ahead/behind is measured against local remote refs, so a deck
that has not fetched reads 0/0 everywhere — the one number here that can actively mislead. But twenty
fetches is real network work and doing it on every open would make the screen slow and chatty. Measured:
four real remotes in 2.1s.

**Bounded pool, per-repo timeouts, per-repo errors.** Each repository is two git spawns and spawning is
the expensive part on Windows; six at a time reads four repos in 219ms. One wedged repository on a
network drive must not hold the deck up, and one unreadable repository must not cost the other nineteen
their card.

The deck deliberately does not poll. Twenty repositories is forty processes: cheap once, rude every ten
seconds — and this is a screen you look at deliberately, not a monitor you leave running.

Three sibling ideas were considered and not built: broadcasting one prompt to several repositories (the
biggest leverage, but it sits close to the multi-agent line this project deliberately drew), a
cross-repo dependency drift matrix, and a work journal for handover and billing. The deck came first
because it is felt on every single launch.

## Usage accounting, and why the numbers are presented apart

The CLI reports a run's cost and tokens once, in the `result` event, and then forgets. Nothing accumulates
that per repository over weeks, so "which client is eating my five-hour window" and "what did a month on
this repo come to" were unanswerable. One append-only line per finished run makes both arithmetic.

**A separate JSONL file, not `state.json`.** That document is rewritten atomically on every change;
appending thousands of records to it would mean rewriting the whole file to add 300 bytes. A log wants
`appendFileSync`. Every line is validated on read, because the writer can be killed mid-write — a
truncated final line is normal, and it costs one line rather than the file.

**The four token counts are never summed.** A real Haiku run measured 10 input, 49 output, 0 cache read
and 28,581 cache creation. One combined "tokens" number would be dominated by caching and would mean
nothing, so they are stored and shown apart.

**Cost is labelled notional wherever it appears.** `total_cost_usd` is what the tokens would have cost
through the API; a subscription is not billed per token. Presenting it as money spent would be a lie, and
the honest use — comparing one project against another — survives the label. Totals are rounded on the way
out because summing real CLI costs yields `0.45736200000000005`.

**Two traps in the result record, both of which fail silently.** There is no top-level `model` field: the
model is a KEY of `modelUsage` carrying a `[1m]` context suffix, so `canonicalModel` is preferred. And
`usage` uses snake_case while `modelUsage` uses camelCase for the same numbers — reading the wrong casing
returns a confident zero. Pinned by a test against the captured sample.

**The window is the CLI's, not ours.** `rate_limit_event` gives the real `resetsAt`, which is persisted to
`state.lastRateLimit` because the CLI only mentions it while a run is in flight. Without one, the window
falls back to the last five hours and the UI says so rather than implying precision. It is computed
independently of the selected period, so viewing 90 days does not widen "this window" to 90 days.

Runs are recorded even when the browser tab has closed: the run happened and it spent quota. And a run
whose project was later removed keeps its history, labelled — dropping the row would make the totals
disagree with the rows.

## A total is not an answer

The per-project table said *how much*; the immediate next question is *which run*, and then *which
conversation*. So a project opens up into every individual run — timestamp, chat, model, turns, duration,
tokens, cost — plus its chats ranked by cost, with one click from a run to the chat that caused it.

`aggregateProject` reuses the same `add` and `round` helpers as the cross-project report rather than
summing again. Two implementations of one sum is how a detail page ends up disagreeing with the row that
led to it, and a test compares the two directly for exactly that reason.

The run table is capped at 250 rows because 4000 rows is not detail, it is a wall — and the number
dropped is returned and displayed, since a silently truncated table reads as "that is all there was". The
totals above it still cover everything.

Verified with three real runs across two projects: attribution came out 84%/16%, the drill-down listed
them newest-first, and a chat deleted earlier showed as `Deleted chat` with its cost intact — which is
the point of labelling rather than hiding it.

## Whole-pane views are one field

Settings, the deck and usage each take the entire pane. Three booleans could represent states that must
never exist (settings *and* the deck open leaves the user with two "back" affordances that disagree), and
every new view added another pair of writes to keep in sync. `view: 'workspace' | 'deck' | 'usage' |
'settings'` makes the exclusivity a type instead of a convention, and `Esc` has exactly one meaning:
return to the workspace.

## Attachments needed `--add-dir`

Reported with a screenshot: a pasted image did nothing, and the tool card read *"Claude requested
permissions to read from .../.flightdeck/attachments/...png, but you haven't granted it yet."*

The cause is a consequence of an earlier decision. Attachments are stored outside every repository — a
screenshot is not part of anyone's source tree — and the path is passed to the agent rather than the bytes,
to keep a 2 MB image out of the context window. But outside the repository means outside the session's
working directory, and the CLI refuses tool access there. Flight Deck has no approval channel to answer the
request with, so the file was unreachable in every permission mode except `bypassPermissions`.

Fixed by passing `--add-dir <attachmentsDir>` on every run. One directory, owned by Flight Deck, granting
nothing over the user's own files. Passed on resumed sessions as well, because a chat can refer back to a
file attached several turns ago.

Two smaller things fell out of it. The attachments path had two definitions — the writer grouped by day
under `stateDir()`, the storage route used the parent — so it now lives in `platform.ts` with everything
else machine-specific, and a test forbids rebuilding it elsewhere. And the feature had no test that would
have caught this: the new one asserts the flag, its argv shape, and that only that one directory is granted.

Verified with a real run rather than by reading the help text: an 8x8 magenta PNG through the real upload
route, its path in a real prompt, `Read` returning `isError=false` with base64 image content, and the model
answering "Magenta."

## Stopping background servers on Windows

Worth recording because it cost a wrong diagnosis: `kill <pid>` on an `npx tsx server/index.ts` job does not
reliably stop the server — npx spawns node as a child, and killing the wrapper leaves the child listening. A
stale dev-mode server then answered requests meant for a production-mode one, and the static assets looked
like 404s when the real cause was that the new process never got the port. Kill by the PID that holds the
port: `netstat -ano | grep :5174`, then `taskkill /PID <pid> /F`.

## The logo, and resizing without a dependency

The supplied mark was 1254x1254 and 1.5 MB — fine as a source, absurd as a favicon. There is no image
library in this project and adding one for a one-off would break the no-new-dependency rule, and no
ImageMagick or Pillow on the machine. (`convert` on PATH here is the Windows *filesystem* converter, which
must never be run by accident.)

So the assets were generated by a throwaway script using `node:zlib` alone: inflate the IDAT stream, undo
the per-scanline filters including Paeth, box-average downscale with premultiplied alpha so transparent
pixels do not drag colour toward black, then re-encode. The script lives in the scratchpad, not the repo —
what is committed is four PNGs (512, 180, 64, 32). Their validity was checked independently in Python:
chunk CRCs, IHDR fields, and inflated size against `height x (width x 4 + 1)`.

The mark carries its own dark haze rather than a transparent background (corner alpha 136), so it sits on a
plain rounded tile in the sidebar; an accent-filled square behind it would fight the gradient.

## A failed run has to say why

Reported as "something is wrong with chat?": a message produced a summary line reading `0 turns · 112ms ·
~$0.000` and nothing else. No error, no text, no explanation.

The cause was in the reducer, not the CLI. A `result` record carries `subtype` (`success`,
`error_during_execution`, `error_max_turns`) and, on failure, the explanation in `result` — and both were
dropped on the floor. `reduce()` set the summary and moved on, so a dead run rendered as a tidy line of
statistics. That is precisely the "something went wrong" this project forbids, arrived at by omission.

Now a `done` with `isError` raises a real error carrying the CLI's own words, and the quieter case is covered
too: a run that reports success but produced no assistant text and zero turns says so, and names the usual
causes (a blocking hook, a session that would not resume, a rejected argument) rather than leaving an empty
transcript under a summary.

Three theories were tested against the real CLI before writing any of this, and all three were wrong —
`--add-dir` does not break `--resume`, resuming a session that another process is holding works, and the
import path already sets `lastMessageAt` so the first message resumes rather than claiming the id. Which is
the point of the fix: the tool has to report what actually happened rather than have someone guess at it
afterwards.

## Usage from transcripts, and the cost column that does not exist

"Why can't I see the usage, especially for this project after this long conversation?" Because `usage.jsonl`
only records runs Flight Deck spawned. The conversation in question was a Claude Code session in an editor:
same quota, same repository, invisible here.

Transcripts fix it. Every assistant entry carries `message.usage` with real token counts and a real model,
and sessions are found by the CLI's own encoding of the cwd, so anything run in a project's folder counts.
On this machine that surfaced 17 sessions for one project — 1,623 assistant messages and 1.8M output tokens,
of which one session was 1,558 messages on its own.

**There is no cost in a transcript.** `total_cost_usd` lives in the `result` record, which `-p` writes to
stdout and never to the file. Two honest options existed: price the tokens with a built-in table, or report
tokens and say cost is unavailable. A price table would be wrong the day rates change and would make the one
number someone might act on a guess, so transcript sessions are reported apart from the cost figures, with
that stated in the UI.

Performance mattered because the transcript that prompted this is 15 MB. Lines are prefiltered on the
substring `"usage"` before parsing: 42ms to read, 38ms to scan, 175ms for all 17 sessions. `message.usage` is
snake_case while the result record's `modelUsage` is camelCase — reading the wrong one returns a confident
zero, so a test pins the casing.

The page's empty state now requires BOTH sources to be empty. "Nothing recorded yet" while a 15 MB
transcript sat on disk is what made this look broken rather than incomplete.

## Update checks ask git, not GitHub

Someone who forks or clones this repository should hear about new commits. The obvious implementation is the
GitHub API, and it is wrong three times over: it needs a hardcoded repository, so a fork would be told about
*this* repo rather than their own; it is a third-party request from an app whose Privacy section says it makes
none of its own; and it brings tokens and rate limits with it.

The install is already a git clone with a remote, so the question is just `HEAD..@{u}`. A fork compares against
the fork, which is where its owner actually pushes and pulls. No key, no service, no hardcoded URL — and it
works for a private mirror or a self-hosted remote without changing anything.

**Every unusual situation is a state rather than an error**: `not-a-repo` for a zip download, `no-upstream` for
a local branch, `ahead` for someone with unpushed work, `diverged` for a fork that has its own commits. Each
gets its own sentence in the UI, because vague status text is what makes people ignore an update prompt.

**`incoming` lists the commits, not just a count.** "3 commits behind" tells you nothing about whether to bother;
three subjects tell you immediately.

**Apply is `merge --ff-only`, and refuses more often than it acts.** A dirty tree is refused because the person
most likely to press that button is someone editing Flight Deck itself. A diverged fork is refused rather than
merged — a merge commit nobody asked for, in someone's own fork, is far worse than a refusal. Nothing resets,
rebases or stashes, and a test asserts those words appear nowhere in the file. Dependencies are not installed and
the server is not restarted, because both would kill the process handling the request; the response says to do
both.

**The network is only touched when what we know is stale.** A local read is free and happens per launch; a fetch
happens at most every six hours, or on demand. The setting to turn it off is enforced on the server as well as
the client, so it means what it says.

Verified against real repositories rather than mocks — a bare remote and two clones covering all seven states
plus the two refusals, confirming `HEAD` was untouched in both. Mocked git would have proved nothing here, since
the whole point of asking git is that git is the source of truth.

## CONTRIBUTING.md

Written from the rules already in force rather than invented for the occasion: the branch prefixes, the
imperative-subject commit format, the dependency-justification rule, and the eight hard rules are the same ones
the maintainer works under, which is why CLAUDE.md is linked rather than paraphrased.

The section that matters most is "say what you ran it against". This project has a documented history of bugs
that typechecked, passed unit tests, and only failed on a real machine — `--verbose`, `GIT_ASKPASS`,
`ENAMETOOLONG`, the shell tool being named `PowerShell` — so "tests pass" is stated outright as insufficient
evidence, with the specific verification each area needs.

## Enter sends

Originally Ctrl+Enter sent and Enter inserted a newline, on the reasoning that prompts here are often several
lines and losing one to a stray Enter is infuriating. In practice the opposite cost was higher: every short
message needed two keys, and every chat interface the user works in sends on Enter. Reversed on request.

Enter sends, Shift+Enter (or Alt+Enter) makes a newline, and Ctrl/Cmd+Enter still sends for the muscle memory
it built. Two details that are easy to miss:

- **An IME composition Enter must not send.** Confirming a candidate would swallow the word being typed. The
  `isComposing` guard comes before the send, and a test asserts that ordering.
- **The commit box keeps Ctrl+Enter.** A commit body is genuinely multi-line, and committing is a git action
  rather than a message. Enter stays a newline there.

The hint beside the input now reads "Shift+Enter for a new line" rather than naming the send key: Enter sending
is discovered on the first message, whereas the newline has to be told.

## A blank screen from editing Flight Deck with Flight Deck

Using Flight Deck on its own repository, an agent added a delete-confirmation dialog to the chat row: it passed
`onConfirm={setConfirm}` but never declared the state and never rendered `<ConfirmDialog>`. `tsc` reported both
errors immediately — but **the dev server does not typecheck**. Vite hands files to esbuild, which strips types
and serves them, so the app booted, the sidebar threw `ReferenceError: confirm is not defined` on render, and
React unmounted the tree: a blank page with no visible error.

Two things follow from it.

**The sidebar now has a render test.** `test/chatInteractions.test.tsx` renders it with a chat and a sub-chat,
which fails loudly on exactly this class of mistake. Verified by reintroducing the bug and watching it fail with
the same ReferenceError before restoring.

**Editing the running app from inside itself is a real hazard**, and worth stating plainly rather than
engineering around: any half-finished client edit takes the window you are working in with it, and the recovery
is a terminal. `npm run typecheck` after an agent touches client code is the cheap guard; doing that work in a
second checkout is the safe one.

## Commit history is read-only, and paged by skip

A History tab beside Staged and Unstaged, because a past commit is still source control rather than a separate
place. It lists commits, expands to their files, and shows any file's diff through the same renderer as the
working tree — so a change reads the same whether it is five minutes or five months old.

**No revert, no reset, no cherry-pick, and no route that could become one.** A test asserts those words appear
nowhere in the file and that history registers no write routes at all. Looking back at a commit is a different
act from undoing it; the second belongs in a terminal where it is deliberate.

Paging asks for one row more than it shows and reports `hasMore` from the overflow, so a repository with 40,000
commits never pays for a count. `skip` rather than a cursor, because git counts from HEAD: a commit made
mid-scroll shifts the window by one, which duplicates a row rather than skipping one, and the client
de-duplicates by sha.

Five parsing details, each found by running real git rather than writing fixtures: `%D` prints `HEAD -> main`,
which collapses to a single chip; a rename arrives as `dir/{old => new}.ts` with the prefix factored out; a
binary file reports `-` where a count belongs, so `Number(x) || 0` and not `Number(x)`; `--numstat` has no
status letter and `--name-status` supplies it; and an empty repository makes `git log` fail, which is "no
commits yet" rather than an error. The commit body is a separate `--format=%b` call, because a message can
contain the separator the format string uses.

## Word-level diff: similarity counts words, not punctuation

A unified diff says a line went out and another came in. When one identifier changed inside eighty characters,
reading it means comparing two nearly identical rows by eye — so the changed words are picked out inside the
row.

Token-level LCS rather than character-level: a character diff of `foo(a)` becoming `bar(a)` highlights fragments
of both names, where word boundaries keep identifiers whole. The cost is quadratic in tokens, which is nothing
at these sizes, and Myers is not worth the complexity.

**The part that took two attempts was the similarity floor.** Below some amount of shared content the two lines
are different lines rather than an edit of one, and highlighting those word by word produces a stripe of noise
that hides the shape of the change. Measuring similarity over all tokens put `alpha(beta, gamma)` and
`delta(epsilon, zeta)` at 57 per cent — they share brackets, a comma and a semicolon — so a complete rewrite
came out striped. Counting words only scores that pair at zero, which is the truth. Whitespace-only differences
are left plain for the same reason: reformatting would otherwise light up the gaps between unchanged tokens.

Verified on a real commit from this repository: one pair highlighted (`Ctrl` becoming `Shift`, plus the appended
text) and twenty-two lines left plain because they were replacements rather than edits. The emphasis is the
row's own hue at roughly three times the alpha — a different hue would read as a third kind of change.

## Slash commands: verified before built

The first thing done was not code. A `.claude/commands/hello.md` containing "reply with exactly SLASHWORKS" was
run through `claude -p`, because autocomplete for something that silently did nothing would be worse than no
autocomplete at all. It returned `SLASHWORKS`, and later did so again through Flight Deck's own stream.

That check also produced a false negative worth recording: `claude -p "/hello"` at a Git Bash prompt answers
"what would you like me to do with `D:/tools/Git/hello`", because MSYS path-translates any argument beginning
with a slash. It looked exactly like slash commands not working headless. Flight Deck sends prompts as JSON on
stdin and is immune, but anyone testing this from bash needs `MSYS_NO_PATHCONV=1`.

Commands are read off disk because there is no headless route that lists them. That means this code encodes the
CLI's layout conventions, so it is written to fail quietly: a missing directory contributes nothing, and a file
without frontmatter still becomes a command described by its first line.

**The interaction that matters is Enter.** Enter now sends, so an unguarded Enter would fire `/dep` as a prompt
instead of completing it to `/deploy`. The menu takes Enter, Tab and the arrows while it is open, and a test
asserts that guard sits before the send. The menu opens upward because the input is already at the bottom of the
window, and picking happens on `mousedown` because the textarea's blur would otherwise close the menu before a
click could land.

## Portability is now enforced, not trusted

Asked directly: why does the repository mention a specific drive and username at all, and would that stop anyone
else running the tool?

**It would not have.** Every occurrence was a comment, a test fixture or the project's own GitHub URL. Nothing
resolved a machine path at runtime — `platform.ts` composes every location from `homedir()` and this module's own
URL, and the audit confirmed not one absolute path literal outside `server/shells.ts`, where `C:\Windows` and
`/bin/sh` are OS constants rather than facts about a machine.

But three of those occurrences were worse than untidy:

**The captured sample leaked client work.** `docs/stream-sample.jsonl` is a real run, so it arrived carrying the
author's home directory, the installed plugin and skill list, and the names and paths of real client
repositories. Two tests read that file, so it was sanitised by substitution with a structural fingerprint —
record types, key sets and value kinds — asserted identical before and after. The tests that read it care about
shapes, not strings, and both still pass.

**A fixture path was quietly broken.** `path: 'E:\muhaz\flightdeck'` in a test contained `\f`, which JavaScript
reads as a formfeed, so the fixture's project path was `E:\muhaz<FF>lightdeck`. Harmless, since nothing touched
disk with it, but it is exactly the failure that makes a Windows path literal a bad idea in the first place.
Fixtures now use forward slashes.

**A real client identity was UI placeholder text.** The git identity fields suggested a client's name and email
address as examples. Now `your name` and `you@example.com`.

The durable part is `test/portability.test.ts`, which turns CLAUDE.md rule 8 from a convention someone has to
remember into a failing build. Nine assertions: no author name outside the repository link, no home-directory
path in shipped code, `platform.ts` composing rather than containing, absolute literals confined to the shell
module and only as OS constants, no assumed projects folder, a clean sample that is still a full capture, no
hardcoded URLs beyond a short allowed list, and a regression list of the client names that leaked once already.

It was written twice. The first version failed on four legitimate cases — the project's own URL, an
`example.com` fixture, a generic `/home/dev/` encoding fixture, and the test naming the terms it searches for.
A guard that cries wolf gets deleted, so the exceptions are named and justified rather than the thresholds
loosened, and the file excludes itself because it necessarily contains the strings it looks for.

Then it was verified by planting `const FALLBACK = 'C:\Users\muhaz\repos'` in a route: three separate assertions
caught it. Worth noting that the *first* attempt to plant it silently did nothing — the anchor string it replaced
did not exist in that file — and the run came back green. A verification that quietly fails to verify is the same
trap as a test that passes for the wrong reason, so the plant now asserts its own presence before the guard is
run.
"""

## Dropping a stash is checked against the stash you saw

There was no way to delete a stash at all: the row offered restore and nothing else, so an unwanted stash could
only be removed by applying it or by going to a terminal.

`git stash drop` takes a position, and dropping one renumbers everything after it. That makes an index-only delete
quietly dangerous: the list on screen goes stale the moment anything else touches the stashes, and the second
click lands on a different stash than the first. Demonstrated in the test with real git — position 1 holds
"second work", and after that drop position 1 holds "first work".

So the request carries the subject the row displayed, and the route re-reads the list and refuses on a mismatch
rather than dropping something the user never chose. Verified live against three real stashes: the repeat request
came back with "Position 1 now holds ... rather than ..." and nothing was dropped.

It always confirms, regardless of the confirmation-level setting, and the dialog names the stash. This is the one
action in that panel with no way back — the reflog technically keeps the commit for a while, but nothing in this
UI can reach it and no ordinary user will, so it is treated as permanent.
