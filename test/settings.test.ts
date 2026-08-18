import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

/**
 * Every accent offered in the UI must exist in themes.css, and every rule there must be reachable
 * from the UI. A mismatch is silent and total: an unmatched `data-accent` leaves the app on the
 * default colour with nothing to explain why, which reads as "the setting is broken".
 */
const themes = readFileSync(fileURLToPath(new URL('../client/styles/themes.css', import.meta.url)), 'utf8');
const page = readFileSync(
  fileURLToPath(new URL('../client/features/settings/SettingsPage.tsx', import.meta.url)),
  'utf8'
);

/** Accents named in the settings page's swatch list. */
function offeredAccents(): string[] {
  const block = /const ACCENTS[\s\S]*?\n\];/.exec(page)?.[0] ?? '';
  return [...block.matchAll(/name: '([a-z]+)'/g)].map(([, name]) => name ?? '');
}

/** Accents that have a rule in the theme layer. */
function styledAccents(): string[] {
  return [...new Set([...themes.matchAll(/\[data-accent='([a-z]+)'\]/g)].map(([, name]) => name ?? ''))];
}

/**
 * The body of one accent's rule.
 *
 * Built by scanning rather than by an interpolated regex: escaping a pattern through a template
 * literal is exactly the kind of thing that silently produces a regex matching nothing, and a test
 * that matches nothing passes for the wrong reason.
 */
function accentRule(accent: string): string {
  const selector = `:root[data-accent='${accent}'] {`;
  const start = themes.indexOf(selector);
  if (start < 0) return '';
  const end = themes.indexOf('}', start);
  return end < 0 ? '' : themes.slice(start + selector.length, end);
}

test('every offered accent has styles, and every styled accent is offered', () => {
  const offered = offeredAccents();
  const styled = styledAccents();
  assert.ok(offered.length >= 5, `expected a real swatch list, found ${offered.length}`);

  // cyan is the default and lives in tokens.css rather than needing an override rule.
  for (const accent of offered) {
    if (accent === 'cyan') continue;
    assert.ok(styled.includes(accent), `${accent} is offered in settings but has no rule in themes.css`);
  }
  for (const accent of styled) {
    assert.ok(offered.includes(accent), `${accent} is styled but not offered in settings`);
  }
});

test('the default accent is the one tokens.css ships', () => {
  assert.equal(DEFAULT_SETTINGS.accent, 'cyan');
  assert.ok(!/\[data-accent='cyan'\]/.test(themes), 'cyan should come from tokens.css, not an override');
});

test('every accent redefines the whole set of accent variables', () => {
  // Overriding the fill but not `--accent-bright` leaves icons the previous colour — a half-applied
  // theme is more confusing than none.
  for (const accent of styledAccents()) {
    const rule = accentRule(accent);
    for (const variable of ['--accent:', '--accent-hover:', '--accent-bright:', '--accent-subtle:']) {
      assert.ok(rule.includes(variable), `${accent} does not set ${variable}`);
    }
  }
});

test('the light theme redefines every surface and text variable', () => {
  const rule = /:root\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/.exec(themes)?.[1] ?? '';
  for (const variable of [
    '--bg-base',
    '--surface-1',
    '--surface-2',
    '--surface-3',
    '--border-subtle',
    '--border',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--accent-bright',
    '--diff-add-bg',
    '--diff-del-bg'
  ]) {
    assert.ok(rule.includes(variable), `the light theme leaves ${variable} at its dark value`);
  }
});

test('each accent has a light-theme companion so marks stay visible on white', () => {
  for (const accent of styledAccents()) {
    const pattern = new RegExp(`\[data-accent='${accent}'\]\[data-theme='light'\]`);
    assert.ok(pattern.test(themes), `${accent} has no light-theme adjustment; a bright mark on white is invisible`);
  }
});

test('density only touches the type scale', () => {
  const rule = /:root\[data-density='compact'\]\s*\{([^}]*)\}/.exec(themes)?.[1] ?? '';
  assert.match(rule, /--ui-font-size/);
  // Spacing lives in utility classes; a density rule that tried to change it would be lying.
  assert.ok(!rule.includes('padding'), 'density must not attempt to change spacing');
});
