import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.ts';
import { SettingsPage } from '../client/features/settings/SettingsPage.tsx';

/** Mirrors the app shell: `IconButton` uses a Radix tooltip, which throws outside its provider. */
const render = (settings: Settings = DEFAULT_SETTINGS) =>
  renderToStaticMarkup(
    <Tooltip.Provider>
      <SettingsPage settings={settings} onUpdate={() => {}} onReset={() => {}} onClose={() => {}} />
    </Tooltip.Provider>
  );

test('appearance and behaviour both live under General', () => {
  const html = render();
  assert.match(html, />Appearance</);
  assert.match(html, />Behaviour</);
  // A separate nav entry for behaviour would mean two clicks for one page of preferences.
  assert.equal((html.match(/>Behaviour</g) ?? []).length, 1, 'Behaviour should be a card, not also a nav item');
});

test('every nav section is reachable', () => {
  const html = render();
  for (const label of ['General', 'Git &amp; Commit', 'AI Assistant', 'Terminal', 'Shortcuts', 'Privacy']) {
    assert.match(html, new RegExp(`>${label}<`), `${label} missing from the nav`);
  }
  // Each section is backed by settings that do something, so nothing is a disabled placeholder any
  // more. A dead nav entry was honest while the pages were empty; now it would just be a bug.
  assert.ok(!/>Not built yet</.test(html), 'no section should still be a placeholder');
});

test('the nav is the only place a section is named twice', () => {
  const html = render();
  // The header renders the active section's own label, so General appears in nav + heading and the
  // rest appear once. A count above two means a stray duplicate crept in.
  for (const label of ['Git &amp; Commit', 'AI Assistant', 'Shortcuts', 'Privacy']) {
    const count = (html.match(new RegExp(`>${label}<`, 'g')) ?? []).length;
    assert.equal(count, 1, `${label} rendered ${count} times`);
  }
});

test('every accent swatch is rendered with an accessible name', () => {
  const html = render();
  for (const label of ['Cyan', 'Violet', 'Blue', 'Green', 'Amber', 'Pink', 'Red']) {
    assert.match(html, new RegExp(`aria-label="${label}"`), `${label} swatch missing`);
  }
});

test('the selected accent and theme are reflected in the markup', () => {
  const html = render({ ...DEFAULT_SETTINGS, accent: 'violet' });
  assert.match(html, /aria-label="Violet"[^>]*aria-pressed="true"/);
  assert.match(html, /aria-label="Cyan"[^>]*aria-pressed="false"/);
});

test('the startup toggle exposes its state to assistive tech', () => {
  const on = render({ ...DEFAULT_SETTINGS, restoreLastProject: true });
  assert.match(on, /role="switch"[^>]*aria-checked="true"/);
  const off = render({ ...DEFAULT_SETTINGS, restoreLastProject: false });
  assert.match(off, /role="switch"[^>]*aria-checked="false"/);
});

test('the confirmation hint states which actions always ask', () => {
  const html = render();
  // The setting must not imply it can disable the guard on irreversible operations.
  assert.match(html, /always ask/);
});

test('the switch knob is anchored, not left to its static position', () => {
  // The bug: an absolutely-positioned knob with no `left` takes its static position from the
  // button's centred text alignment, so the translate moved it 20px right of centre and it hung off
  // the track. The anchor is what makes the geometry deterministic.
  const html = render();
  const knob = /<span class="([^"]*translate-x[^"]*)"/.exec(html)?.[1] ?? '';
  assert.ok(knob, 'expected to find the knob');
  assert.match(knob, /left-0\.5/, 'the knob must be anchored to the left edge of the track');
  assert.match(knob, /top-0\.5/);
});

test('the knob travels exactly its own travel distance', () => {
  // track 44 - knob 20 - inset 2 - inset 2 = 20px, which is translate-x-5.
  const on = render({ ...DEFAULT_SETTINGS, restoreLastProject: true });
  assert.match(on, /translate-x-5/);
  const off = render({ ...DEFAULT_SETTINGS, restoreLastProject: false });
  assert.match(off, /translate-x-0/);
  assert.ok(!/translate-x-\[/.test(off), 'no arbitrary pixel values — the travel should be derivable');
});
