import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Every shipped colour pair, measured.
 *
 * DESIGN.md has always claimed each pair was "measured, not chosen by eye" — and nothing enforced it, so the
 * claim decayed. This test found `--danger` at 4.27:1 on `--surface-2` and 3.66:1 on `--surface-3`, a floor it
 * had been under for as long as the token existed: it had only ever been checked against one of the three
 * planes it is used on.
 *
 * The CSS is parsed rather than duplicated here. A test that restates the palette tests only that someone typed
 * the same hex twice.
 */
const tokens = readFileSync('client/styles/tokens.css', 'utf8');
const themes = readFileSync('client/styles/themes.css', 'utf8');

/** Body text and any mark that carries meaning. */
const BODY = 4.5;
/** Non-essential text — a timestamp, a path — where WCAG's large/incidental allowance applies. */
const INCIDENTAL = 3;

const ACCENTS = ['cyan', 'violet', 'blue', 'green', 'amber', 'pink', 'red'] as const;

function luminance(hex: string): number {
  const channel = (value: number): number =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  const digits = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((at) => channel(Number.parseInt(digits.slice(at, at + 2), 16) / 255));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** `[^#]*` rather than `\s*`: a token may carry a comment between its name and its value. */
function pick(name: string, scope: string): string {
  const match = new RegExp(`${name}:[^#;]*(#[0-9a-fA-F]{6})`).exec(scope);
  assert.ok(match?.[1], `${name} is not defined as a hex in this scope`);
  return (match?.[1] as string).toLowerCase();
}

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[[\]$'*.]/g, (character) => `\\${character}`);
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1] ?? '';
}

const dark = {
  'bg-base': pick('--bg-base', tokens),
  'surface-1': pick('--surface-1', tokens),
  'surface-2': pick('--surface-2', tokens),
  'surface-3': pick('--surface-3', tokens)
};
const lightRule = block(themes, ":root[data-theme='light']");
const light = {
  'bg-base': pick('--bg-base', lightRule),
  'surface-1': pick('--surface-1', lightRule),
  'surface-2': pick('--surface-2', lightRule),
  'surface-3': pick('--surface-3', lightRule)
};

test('text clears its floor on every surface, in both themes', () => {
  for (const [theme, scope, surfaces] of [
    ['dark', tokens, dark],
    ['light', lightRule, light]
  ] as const) {
    for (const [name, floor] of [
      ['--text-primary', BODY],
      ['--text-secondary', BODY],
      ['--text-muted', INCIDENTAL]
    ] as const) {
      const colour = pick(name, scope);
      for (const [surface, hex] of Object.entries(surfaces)) {
        const ratio = contrast(colour, hex);
        assert.ok(ratio >= floor, `${theme}: ${name} on ${surface} is ${ratio.toFixed(2)}, needs ${floor}`);
      }
    }
  }
});

test('white reads on every fill', () => {
  // A fill exists to carry a white label. One that cannot is not a fill, it is a decoration.
  for (const name of ['--accent', '--accent-hover', '--fill-success', '--fill-warn', '--fill-info', '--fill-danger']) {
    const ratio = contrast('#ffffff', pick(name, tokens));
    assert.ok(ratio >= BODY, `white on ${name} is ${ratio.toFixed(2)}`);
  }
});

test('a mark reads on all three planes it can appear on', () => {
  /*
   * THE BUG THIS CAUGHT. `--danger` was #EF4444, measured once against `--surface-1` and never against the
   * card or the popover it also lands on: 4.27:1 and 3.66:1. Marks appear on panels, cards and menus, so all
   * three are checked.
   */
  for (const name of ['--accent-bright', '--success', '--danger', '--warn', '--info']) {
    const colour = pick(name, tokens);
    for (const surface of ['surface-1', 'surface-2', 'surface-3'] as const) {
      const ratio = contrast(colour, dark[surface]);
      assert.ok(ratio >= BODY, `${name} on ${surface} is ${ratio.toFixed(2)}`);
    }
  }
});

test('every accent works as both a fill and a mark', () => {
  for (const accent of ACCENTS) {
    // Violet is the default and lives in tokens.css; the rest are overrides.
    const scope = accent === 'violet' ? tokens : block(themes, `:root[data-accent='${accent}']`);
    assert.ok(scope.length > 0, `${accent} has no rule`);

    for (const name of ['--accent', '--accent-hover'] as const) {
      const ratio = contrast('#ffffff', pick(name, scope));
      // A brighter hover often fails this, which is why several accents darken instead.
      assert.ok(ratio >= BODY, `${accent}: white on ${name} is ${ratio.toFixed(2)}`);
    }

    const bright = contrast(pick('--accent-bright', scope), dark['surface-1']);
    assert.ok(bright >= BODY, `${accent}: bright on a panel is ${bright.toFixed(2)}`);

    const onWhite = contrast(
      pick('--accent-bright', block(themes, `:root[data-accent='${accent}'][data-theme='light']`)),
      light['surface-1']
    );
    assert.ok(onWhite >= BODY, `${accent}: light bright on white is ${onWhite.toFixed(2)}`);
  }
});

test('each surface step is a visible increment', () => {
  /*
   * The depth of a dark UI comes from the distance between planes. An earlier badge used `--surface-3` on
   * `--surface-2` and measured 1.1:1, which read as no background at all — the floor is set just under that
   * so a step cannot silently collapse.
   */
  for (const [theme, surfaces] of [
    ['dark', dark],
    ['light', light]
  ] as const) {
    const steps = Object.entries(surfaces);
    for (let index = 1; index < steps.length; index++) {
      const [previous, from] = steps[index - 1] as [string, string];
      const [current, to] = steps[index] as [string, string];
      const ratio = contrast(from, to);
      assert.ok(ratio >= 1.05, `${theme}: ${previous} → ${current} is only ${ratio.toFixed(3)}`);
    }
  }
});

test('the accent is never a diff colour', () => {
  /*
   * The one rule the accent exists to satisfy: a highlight in the diff viewer must never be mistaken for
   * something interactive. Green and amber are offered but labelled in Settings as sharing a hue; the *default*
   * must not be one of them.
   */
  const success = pick('--success', tokens);
  const danger = pick('--danger', tokens);
  const accent = pick('--accent-bright', tokens);
  assert.notEqual(accent, success);
  assert.notEqual(accent, danger);
  // Violet: far from both hues, and it is what tokens.css ships.
  assert.equal(pick('--accent', tokens), '#7c3aed');
});
