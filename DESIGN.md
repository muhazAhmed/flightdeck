# Flight Deck — design system

Dark by default with a full light theme, cyan by default with seven accents. Built to be stared at
for eight hours without irritating you.

Companion to [SPEC.md](./SPEC.md), which owns architecture and scope.

---

## Principles

1. **Semantic colors are reserved.** Green means *added / succeeded*. Red means
   *removed / failed*. Amber means *caution*. Nothing decorative may use them. This is
   why the accent is cyan — a diff must never be ambiguous.
2. **Density over comfort.** This is a tool, not a landing page. Tight line-height,
   small radii, no oversized padding. You should see three panels of real content at
   1440px.
3. **Motion confirms, never entertains.** 120–200ms, ease-out, no springs, no bounce.
   If an animation makes you wait, it is a bug.
4. **Never say "something went wrong."** `git` and `claude` emit real stderr. Show it
   verbatim, with a copy button.
5. **Nothing silent.** Every action produces a visible outcome — toast, inline state, or
   card. If the UI looks unchanged after a click, that is a bug.

---

## Color tokens

The dark values below are the defaults, defined once on `:root` in `tokens.css` and exposed to
Tailwind via `@theme`. `themes.css` overrides a subset of them per `[data-theme]`, `[data-accent]`
and `[data-density]` — which is why a theme change is one attribute write rather than a re-render.

### Surfaces and text

| Token | Value | Use | On panel |
|---|---|---|---|
| `--bg-base` | `#101319` | app background, behind everything | — |
| `--surface-1` | `#161A22` | panels (sidebar, chat, changes) | — |
| `--surface-2` | `#1C212B` | cards, tool cards, inputs | — |
| `--surface-3` | `#242A36` | hover, raised menus, popovers | — |
| `--border-subtle` | `#252B37` | panel dividers, card edges | — |
| `--border` | `#333B4A` | input borders, resize handles | — |
| `--text-primary` | `#E8EBF0` | body, headings | 14.6:1 |
| `--text-secondary` | `#A4ADBD` | labels, metadata, timestamps | 7.7:1 |
| `--text-muted` | `#6F7889` | placeholders, disabled | 3.9:1 |

**Not near-black.** `#0A0A0B` was tried first and read as a dead void: panel edges vanished and
the whole app looked switched off. The stack is lifted into slate with a slight blue cast, which is
what gives a dark UI depth. Each step is a visible increment, so a card on a panel on the app
background reads as three planes without shadows.

Every text pair above is measured, not judged: primary and secondary clear AA for body text
(4.5:1), muted clears the 3:1 floor for non-essential text, and `--accent-fg` on an accent fill is
7.5:1.

### Accent (cyan)

| Token | Value | Use |
|---|---|---|
| `--accent` | `#0E7490` | button fill, count badges — dark enough to carry white text (5.4:1) |
| `--accent-hover` | `#10809E` | button hover — still 4.6:1 with white |
| `--accent-bright` | `#22D3EE` | icons, links, focus ring — 9.6:1 on a panel |
| `--accent-fg` | `#FFFFFF` | text on an accent fill |
| `--accent-subtle` | `rgb(34 211 238 / 0.14)` | selected row background |

**The accent does two opposite jobs, so it is two values.** A *fill* has to be dark enough for the
label on top of it: white on `#0E7490` is 5.4:1, where white on the old `#06B6D4` was 2.4:1 and
failed outright. A *mark on a dark surface* — icon, link, focus ring — needs the opposite, which is
what `--accent-bright` is for. Using one value for both is what produced unreadable buttons.

**Counts are filled with a white label.** Earlier attempts used a surface step (`--surface-3` on
`--surface-2`) which is a 1.1:1 difference and read as no background at all.

**Colour carries meaning, so the fills differ by what is being counted:** accent for totals and
remote actions, `--fill-success` for staged (work that is ready), `--fill-warn` for changed (work in
progress), `--fill-info` for stashes (set aside). Those are separate tokens from `--success` /
`--warn` / `--info`, which are *marks* — white on the bright green is about 2.3:1 and unreadable,
while white on the fills clears 4.9:1 or better in both themes.

**One or two digits are a circle** (`size-5` fixes both axes); three or more widen into a pill.
Horizontal padding on a single digit is what produces an oval. A zero count stays a bordered neutral
chip, because a filled badge is a call to attention and a zero has nothing to attend to.

### Semantic — never used decoratively

| Token | Value | Meaning |
|---|---|---|
| `--success` | `#22C55E` | committed, build passed, added |
| `--danger` | `#EF4444` | failed, deleted, destructive action |
| `--warn` | `#F59E0B` | dirty tree, bypass mode on, unsaved |
| `--info` | `#A78BFA` | neutral notice — violet, so it never reads as accent |

Info messages lead with an icon and a `--surface-2` background; the violet is a 1px
left border only. Info must never look like a call to action.

### Diff

| Token | Value | Use |
|---|---|---|
| `--diff-add-bg` | `rgb(34 197 94 / 0.16)` | added line background |
| `--diff-add-gutter` | `#22C55E` | `+` marker, gutter bar |
| `--diff-del-bg` | `rgb(239 68 68 / 0.16)` | removed line background |
| `--diff-del-gutter` | `#EF4444` | `-` marker, gutter bar |
| `--diff-word-add` | `rgb(34 197 94 / 0.28)` | intra-line word highlight |
| `--diff-word-del` | `rgb(239 68 68 / 0.28)` | intra-line word highlight |

Tints are stronger and gutters brighter than the first pass: a lifted background needs more of both
before a diff row reads as one.

The diff viewer is ours (`features/changes/DiffView.tsx`) and reads these tokens directly,
which is part of why Monaco was dropped — an embedded editor arrives with its own theme
and looks like a foreign app inside yours. See DECISIONS.md.

---

## Typography

| Role | Font | Size / line-height |
|---|---|---|
| UI | **Geist Variable** | 14px / 22px default, 12.5–13px for metadata, 11.5px for the quietest labels |
| Headings | Geist 500–600 | 14.5px panel titles, 19px page titles |
| Code, diffs, terminal | **JetBrains Mono Variable** | 12.5px / 18px |

Two families, four sizes. That is the whole scale.

**Geist is the UI face**, after Inter and Ubuntu were both tried and rejected in use. It is drawn
for interfaces, holds its shape at 14px where a humanist face goes soft, and its even widths suit
a dense three-panel layout.

**Switching is a one-line change and needs no install.** Two faces ship loaded — Geist and Plus
Jakarta Sans (the rounder option) — so changing `--font-ui` in `tokens.css` is the whole operation.
Nothing else in the codebase names a font.

**Every face is self-hosted** from npm (`@fontsource-variable/*`), imported in
`styles/index.css` — never from a CDN. This is a local tool: it must render with no network, and a
font request that stalls would block first paint. All three are variable builds, so one file covers
every weight, and per-subset `unicode-range` means the browser fetches only the glyphs shown
(~30 kB latin each).

**Type tuning that matters at this size:**

- `font-size: 14px` / `line-height: 22px` — Geist is slightly wider per character than Ubuntu at
  the same nominal size, so it needs a little less of it, but the generous leading stays: that is
  what makes a wall of streamed text readable for an hour.
- `letter-spacing: -0.003em` — Geist sets fractionally loose at UI sizes; this closes words up
  without touching the glyphs.
- **Identifiers go in the mono face.** Anywhere `1`/`l`/`I` or `0`/`O` must be told apart — paths,
  branch names, hashes, diff content — renders in JetBrains Mono. Stronger than any font feature,
  and it survives a change of UI face.
- `font-variant-ligatures: none` on code and terminal text: `!=` becoming a glyph is
  charming in prose and misleading in a diff.

**Numerals.** `font-variant-numeric: tabular-nums` (the `.tabular` class) on line numbers,
counts and timestamps, so columns do not jitter as they update.

**Markdown in the transcript.** The agent writes markdown, so assistant prose is rendered rather
than printed: 14px at 1.6 line-height, headings at 17/16/14.5/14px — close to body size, because
this is chat and an h1 that dwarfs its surroundings breaks the reading rhythm. Inline code is a
bordered chip in the mono face; fenced blocks sit on `--bg-base` inside a subtle border; tables
scroll inside their own container rather than widening the panel. Every element is given a class:
browser defaults would arrive as white headings, blue links and serif blockquotes.

**Your own messages are never re-rendered as markdown** — what you typed is what you see.

---

## Space, radius, elevation

- Spacing scale: `4 · 8 · 12 · 16 · 24 · 32`. Nothing else.
- Radius: `4px` inputs and buttons, `6px` cards, `8px` dialogs. Never pill-shaped.
- Elevation: dark UIs read depth through **borders and surface steps**, not shadows.
  One shadow only, for popovers and dialogs: `0 8px 24px rgb(0 0 0 / 0.5)`.
- Panel gutters: `12px`. Card padding: `12px`. Chat message block spacing: `16px`.

---

## Layout

Resizable and collapsible, three panels, widths persisted to `state.json`.

```
+------------+------------------------------+---------------------+
| PROJECTS   |  CHAT                        |  CHANGES            |
|  240px     |  flex, min 480px             |  360px              |
|  min 180   |                              |  min 280            |
|  collapse  |                              |  collapse           |
|  -> 48px   |                              |  -> hidden          |
+------------+------------------------------+---------------------+
|  TERMINAL  (drawer, 240px, collapsed by default)   Phase 3      |
+-----------------------------------------------------------------+
```

- `shadcn/ui` **Resizable** (react-resizable-panels) for the drag handles. Handle is
  `--border`, 1px, widening to 3px with `--accent-bright` on hover.
- Sidebar collapses to a 48px icon rail — project avatars/initials only, tooltips on
  hover. Changes panel collapses fully to a right-edge tab showing the changed-file
  count.
- The Changes panel stays visible while the agent works. Watching files appear as it
  edits is half the point of the tool.

**Panel contents.**

- **Left** — a titled sidebar: product name, project search (matches name or path), the project
  list with each repo's path on a second line, and a footer showing your global git identity plus
  the settings entry point. Projects expand to their chats.
- **Middle** — chat. Header carries the title, the project path, the quota chip, the model picker
  and the permission mode. Empty state offers suggestion cards that fill the input with real,
  editable prompts.
- **Right** — source control: branch menu, remote actions with commit counts, **Staged / Unstaged
  tabs** with counts, the file list, the diff, and a commit block that leads with the identity the
  commit will carry.

**Unbuilt affordances are visible and disabled**, never hidden and never fake: the settings
buttons render greyed with a "not built yet" tooltip. A disabled control is honest about scope; a
button that opens an empty page is not.

### Keyboard

| Keys | Action |
|---|---|
| `Ctrl+K` | command palette — jump to any project or chat |
| `Ctrl+Enter` | send prompt |
| `Ctrl+B` | toggle sidebar |
| `Ctrl+J` | toggle terminal drawer (Phase 3) |
| `Ctrl+Shift+G` | focus Changes panel |
| `Esc` | close dialog / cancel inline edit |

`Ctrl+K` is the answer to "twenty projects is hard to manage." It should reach anything
in two keystrokes and a few letters.

---

## Components (shadcn/ui)

Pull only these; skip the rest of the library:

`Button` · `Input` · `Textarea` · `Select` · `DropdownMenu` · `Dialog` · `Tooltip`
· `ScrollArea` · `Resizable` · `Tabs` · `Collapsible` · `Badge` · `Separator`
· `Command` (for `Ctrl+K`) · `Skeleton`

Plus `sonner` for toasts. No component library beyond this — everything else is a div
with tokens.

---

## Message channels

Four channels, one job each. Getting this wrong is how tools become noisy.

| Channel | Job | Lifetime | Example |
|---|---|---|---|
| **Inline** | field validation | until fixed | "Not a git repository" under the path input |
| **Toast** | result of an action *you* triggered | 4s, errors stay until dismissed | "Committed 3 files" · "Pull failed: diverged from origin/dev" |
| **Banner** | persistent state you must know | until the state clears | "Agent running in this project" · "Working tree dirty — checkout blocked" |
| **Tool card error** | a failed agent action, in place | permanent in transcript | red-left-border card holding the real stderr |

Rules:

- An error toast always carries the underlying message and a **copy** button.
- A banner is never dismissible if the state it describes is still true.
- Only one banner per panel; the most severe wins (danger > warn > info).
- **Every source-control action confirms**, reversible or not, through one shared
  `ConfirmDialog`: stage, unstage, discard, stash, stash pop. It lists the exact files
  (twelve, then a count) and states the consequence — "reversible, you can unstage
  afterwards" versus "this cannot be undone" — never "Are you sure?". The buttons are
  small icons in dense rows; a mis-click must not silently rewrite the index.
- Icon-only controls carry an `aria-label` and a tooltip with the same text
  (`IconButton`). Row-level actions stay hidden until the row is hovered or focused, so a
  list of twenty files is not a wall of buttons.

---

## Motion

| Interaction | Duration | Easing |
|---|---|---|
| hover, focus, color change | 120ms | `ease-out` |
| collapse / expand panel, drawer | 200ms | `cubic-bezier(0.2, 0, 0, 1)` |
| toast in / out | 180ms | `ease-out` |
| tool card expand | 160ms | `ease-out` |
| streaming text | none | text appears; never animate per token |

Framer Motion only for panel and drawer transitions. Everything else is a CSS
transition. Wrap all of it in `prefers-reduced-motion: reduce` → duration `0ms`.

---

## Performance rules

These are the three places this specific app will get slow. Treat them as constraints,
not optimisations.

1. **Never `setState` per streamed chunk.** Accumulate incoming chunks in a ref and
   flush on a `requestAnimationFrame` tick. Hundreds of renders per second becomes 60.
2. **Virtualise long lists** — chat transcript and diff lines, via
   `@tanstack/react-virtual`. A 4000-line diff must not mount 4000 nodes.
3. **Monaco is lazy and singular.** Dynamic-import the diff editor, mount **one**
   instance and swap its models when you change file. Never one editor per file row.
4. **xterm uses the WebGL renderer** with scrollback capped (~5000 lines).
5. Memoise tool cards; a collapsed card renders a header and nothing else.
6. No layout animation on lists that update while streaming — that is what makes an
   otherwise fast app feel laggy.

---

## States that are easy to forget

- **Empty**: no projects yet → single centered "Add your first project" with the picker.
  No chats in a project → "Start a chat" with the prompt input already focused.
- **Loading**: `Skeleton` rows for the file list and project list. Never a full-page
  spinner — the shell renders instantly, panels fill in.
- **Agent thinking**: a small cyan pulse next to the chat title plus a `stop` button.
  The button must be reachable in one click at all times.
- **Disconnected**: server not reachable → a persistent danger banner with a retry.
  Local tools still crash; say so plainly.
- **Long-running**: a tool card open for >10s shows elapsed time, so a slow `npm ci`
  reads as working rather than hung.

---

## Accessibility (the parts that matter here)

- Focus ring: 2px `--accent-bright`, always visible — never `outline: none` without a
  replacement.
- Text contrast: `--text-secondary` on `--surface-1` is the floor; anything lighter is
  decoration, not information.
- Never encode meaning in color alone: added lines carry a `+`, errors carry an icon,
  the running indicator carries a label in its tooltip.
- Every icon-only button gets an `aria-label` and a tooltip with the shortcut.
