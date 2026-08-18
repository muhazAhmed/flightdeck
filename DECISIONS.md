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
because a repo's path is what distinguishes `Com8-Reality` from `com8_realty_server`. Project
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
