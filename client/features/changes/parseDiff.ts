import type { DiffHunk } from '@shared/types';

/**
 * Parse unified diff text into hunks with real line numbers.
 *
 * A pure function with no React and no DOM, so it is testable on its own — the renderer
 * then does nothing but map these to styled rows.
 *
 * WHY NOT MONACO: the spec originally called for Monaco's diff editor, but we already
 * receive unified diff text from git and never edit inside the view. Monaco costs roughly
 * two megabytes, needs its own theme mapped to our tokens, and its value here is the part
 * we do not use. See DECISIONS.md.
 */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** git marks "no newline at end of file" with a leading backslash. Built from a char code
 *  so the literal survives every tool that touches this file. */
const BACKSLASH = String.fromCharCode(92);

export function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }

    // Everything before the first hunk is git's file preamble (`diff --git`, `index`,
    // `+++`/`---`). It carries no content, and showing it is noise in a review.
    if (!current) continue;

    // A leading backslash marks git's `\ No newline at end of file` note: a marker,
    // not content. Matched via a char code so the literal cannot be mangled in transit.
    if (raw.startsWith(BACKSLASH)) {
      current.lines.push({ kind: 'meta', oldNumber: null, newNumber: null, text: raw.slice(1).trim() });
      continue;
    }

    const marker = raw[0];
    const text = raw.slice(1);

    if (marker === '+') {
      current.lines.push({ kind: 'add', oldNumber: null, newNumber: newLine++, text });
    } else if (marker === '-') {
      current.lines.push({ kind: 'del', oldNumber: oldLine++, newNumber: null, text });
    } else if (marker === ' ' || marker === undefined) {
      // An empty trailing line at the end of the diff is an artefact of splitting on \n.
      if (marker === undefined && raw === '') continue;
      current.lines.push({ kind: 'context', oldNumber: oldLine++, newNumber: newLine++, text });
    }
  }

  return hunks;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(hunks: DiffHunk[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') additions++;
      else if (line.kind === 'del') deletions++;
    }
  }
  return { additions, deletions };
}

export function countLines(hunks: DiffHunk[]): number {
  return hunks.reduce((total, hunk) => total + hunk.lines.length + 1, 0);
}
