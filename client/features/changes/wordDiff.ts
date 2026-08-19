/**
 * Word-level highlighting inside a changed line.
 *
 * A unified diff says "this line went out, that line came in". When the change was one identifier in a long
 * line, reading it means comparing two nearly identical rows by eye. This narrows it to the part that actually
 * moved.
 *
 * Pure, no React, no DOM — the renderer maps the segments to spans. Tested on its own, because the failure mode
 * is subtle: highlighting slightly the wrong range is worse than highlighting nothing, since it points the
 * reader at the wrong thing with full confidence.
 */

export interface Segment {
  text: string;
  /** True when this run differs from the paired line. */
  changed: boolean;
}

export interface WordDiff {
  removed: Segment[];
  added: Segment[];
}

/**
 * Below this much shared content the two lines are different lines, not an edit of one.
 *
 * Highlighting a rewrite word by word produces a stripe of noise that hides the real shape of the change, so
 * those are left plain. 0.35 was chosen by eye against real diffs from this repository: renamed identifiers and
 * changed strings land well above it, replaced statements below.
 */
export const SIMILARITY_FLOOR = 0.35;

/** A line this long is almost always minified or generated; the pairing heuristic stops being useful. */
const MAX_LINE = 2000;

/**
 * Split into words, punctuation runs and whitespace.
 *
 * Tokenising rather than diffing characters is what makes the output readable: a character diff of
 * `getUser` → `getUserById` highlights `ById` correctly but a character diff of `foo(a)` → `bar(a)`
 * highlights fragments of both names. Word boundaries keep whole identifiers together.
 */
export function tokenize(line: string): string[] {
  return line.match(/[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g) ?? [];
}

/**
 * Longest common subsequence over tokens, as a DP table walk.
 *
 * O(n·m) in tokens, not characters, and both lines are capped — a 2000-character line tokenises to a few
 * hundred entries, which is trivial. Myers' algorithm would be faster asymptotically and is not worth the
 * complexity at this size.
 */
function commonRuns(a: string[], b: string[]): { keptA: boolean[]; keptB: boolean[] } {
  const rows = a.length;
  const cols = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? (table[i + 1]![j + 1] ?? 0) + 1 : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }

  // Walk the table once, marking which tokens are shared on each side.
  const keptA = new Array<boolean>(rows).fill(false);
  const keptB = new Array<boolean>(cols).fill(false);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      keptA[i] = true;
      keptB[j] = true;
      i++;
      j++;
    } else if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return { keptA, keptB };
}

/** Words carry the meaning; punctuation and whitespace are scaffolding. */
function isWord(token: string): boolean {
  return /[A-Za-z0-9_$]/.test(token);
}

/** Collapse a token list into runs of the same changed-ness, so the renderer emits few spans. */
function toSegments(tokens: string[], kept: boolean[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const changed = !kept[index];
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += tokens[index];
    else segments.push({ text: tokens[index] ?? '', changed });
  }
  return segments;
}

/**
 * Compare one removed line with one added line.
 *
 * Returns null when highlighting would not help: identical lines, an empty line, a line long enough to be
 * generated, or two lines with too little in common to be an edit of each other. Null means "render plain",
 * which is the honest fallback.
 */
export function wordDiff(removed: string, added: string): WordDiff | null {
  if (removed === added) return null;
  if (removed.length === 0 || added.length === 0) return null;
  if (removed.length > MAX_LINE || added.length > MAX_LINE) return null;

  const a = tokenize(removed);
  const b = tokenize(added);
  if (a.length === 0 || b.length === 0) return null;

  const { keptA, keptB } = commonRuns(a, b);

  /*
   * Similarity counts WORDS ONLY — not punctuation, not whitespace.
   *
   * Two unrelated statements share their brackets, commas and semicolons, and counting those put
   * `alpha(beta, gamma)` and `delta(epsilon, zeta)` at 57% similar, well above the floor, so a complete
   * rewrite came out striped in highlight. Measured over words the same pair scores zero, which is the
   * truth: they have no content in common.
   */
  const sharedWords = (tokens: string[], kept: boolean[]) =>
    tokens.reduce((count, token, index) => count + (kept[index] && isWord(token) ? 1 : 0), 0);
  const shared = sharedWords(a, keptA) + sharedWords(b, keptB);
  const totalWords = a.filter(isWord).length + b.filter(isWord).length;

  // A line with no words at all — `});` becoming `}));` — has nothing a highlight could usefully point at.
  if (totalWords === 0) return null;
  if (shared / totalWords < SIMILARITY_FLOOR) return null;

  const result = { removed: toSegments(a, keptA), added: toSegments(b, keptB) };

  // Whitespace-only changes are left plain: reformatting `a( b )` to `a(  b  )` would otherwise light up the
  // gaps between unchanged tokens, which reads as a change to the code when nothing moved.
  const changedText = [...result.removed, ...result.added].filter((segment) => segment.changed);
  if (changedText.length === 0) return null;
  if (changedText.every((segment) => segment.text.trim().length === 0)) return null;
  return result;
}

export interface PairedLine {
  /** Index into the hunk's line list. */
  index: number;
  diff: WordDiff;
}

/**
 * Pair removed lines with added lines inside one hunk, and diff each pair.
 *
 * git emits a run of `-` lines followed by a run of `+` lines, so the nth removal pairs with the nth addition.
 * That is a heuristic, and it is the same one every diff viewer uses; where the runs are different lengths the
 * extras are left unpaired and plain.
 */
export function pairHunkLines(lines: { kind: string; text: string }[]): Map<number, WordDiff> {
  const paired = new Map<number, WordDiff>();

  let index = 0;
  while (index < lines.length) {
    if (lines[index]?.kind !== 'del') {
      index++;
      continue;
    }

    const dels: number[] = [];
    while (lines[index]?.kind === 'del') dels.push(index++);
    const adds: number[] = [];
    while (lines[index]?.kind === 'add') adds.push(index++);

    for (let offset = 0; offset < Math.min(dels.length, adds.length); offset++) {
      const delIndex = dels[offset]!;
      const addIndex = adds[offset]!;
      const diff = wordDiff(lines[delIndex]!.text, lines[addIndex]!.text);
      if (!diff) continue;
      paired.set(delIndex, diff);
      paired.set(addIndex, diff);
    }
  }

  return paired;
}
