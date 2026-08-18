# Flight Deck — design system

Dark only. Cyan accent. Built to be stared at for eight hours without irritating you.

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

Dark only, but every value is a CSS variable, so a light theme later is a token swap
rather than a refactor. Define once on `:root`; Tailwind v4 picks them up via `@theme`.

### Surfaces and text

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0A0A0B` | app background, behind everything |
| `--surface-1` | `#101012` | panels (sidebar, chat, changes) |
| `--surface-2` | `#17171A` | cards, tool cards, inputs |
| `--surface-3` | `#1F1F23` | hover, raised menus, popovers |
| `--border-subtle` | `#232327` | panel dividers, card edges |
| `--border` | `#2E2E34` | input borders, resize handles |
| `--text-primary` | `#EDEDEF` | body, headings |
| `--text-secondary` | `#A1A1AA` | labels, metadata, timestamps |
| `--text-muted` | `#6E6E77` | placeholders, disabled |

### Accent (cyan)

| Token | Value | Use |
|---|---|---|
| `--accent` | `#06B6D4` | primary button fill, active row indicator |
| `--accent-hover` | `#0891B2` | button hover |
| `--accent-bright` | `#22D3EE` | icons, links, focus ring — highest contrast on dark |
| `--accent-fg` | `#04181C` | text on an accent fill |
| `--accent-subtle` | `rgb(6 182 212 / 0.12)` | selected row background, badge fill |

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
| `--diff-add-bg` | `rgb(34 197 94 / 0.12)` | added line background |
| `--diff-add-gutter` | `#16A34A` | `+` marker, gutter bar |
| `--diff-del-bg` | `rgb(239 68 68 / 0.12)` | removed line background |
| `--diff-del-gutter` | `#DC2626` | `-` marker, gutter bar |
| `--diff-word-add` | `rgb(34 197 94 / 0.28)` | intra-line word highlight |
| `--diff-word-del` | `rgb(239 68 68 / 0.28)` | intra-line word highlight |

The diff viewer is ours (`features/changes/DiffView.tsx`) and reads these tokens directly,
which is part of why Monaco was dropped — an embedded editor arrives with its own theme
and looks like a foreign app inside yours. See DECISIONS.md.

---

## Typography

| Role | Font | Size / line-height |
|---|---|---|
| UI | **Ubuntu** (400 / 500 / 700) | 14px / 21px default, 12.5px / 16px for metadata |
| Headings | Ubuntu 500–700 | 15px panel titles, 20px page titles |
| Code, diffs, terminal | **JetBrains Mono Variable** | 12.5px / 18px |

Two families, four sizes. That is the whole scale.

**Ubuntu is the chosen UI face.** It was briefly replaced with Inter when the interface read
as hard to focus on, but the real cause was that no font was loading at all — neither Ubuntu
nor the mono face was installed, so everything fell back to Segoe UI. With Ubuntu actually
loaded and the size raised, it is the face this tool uses. Swapping it means changing
`--font-ui` in `tokens.css` and the matching import in `index.css`; nothing else references a
font by name.

**Both faces are self-hosted** from npm (`@fontsource/ubuntu`,
`@fontsource-variable/jetbrains-mono`), imported in `styles/index.css` — never from the Google
Fonts CDN. This is a local tool: it must render with no network, and a font request that
stalls would block first paint. Ubuntu is not variable, so weights are separate files and only
400/500/700 latin are pulled (~30 kB each); 300 is too light on `--bg-base` and italics are
unused.

**Type tuning that matters at this size:**

- `font-size: 14px` / `line-height: 21px` — the extra leading is what makes a wall of
  streamed text readable for an hour.
- `letter-spacing: 0` — Ubuntu is already optically wide; negative tracking closes its
  apertures and makes it muddier at this size.
- **Identifiers go in the mono face.** Ubuntu has no disambiguation variants, so anywhere
  `1`/`l`/`I` or `0`/`O` must be told apart — paths, branch names, hashes, diff content — is
  rendered in JetBrains Mono. That is a stronger guarantee than a font feature anyway.
- `font-variant-ligatures: none` on code and terminal text: `!=` becoming a glyph is
  charming in prose and misleading in a diff.

**Numerals.** `font-variant-numeric: tabular-nums` (the `.tabular` class) on line numbers,
counts and timestamps, so columns do not jitter as they update.

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
