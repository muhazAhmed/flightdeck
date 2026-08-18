import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE BUG THIS PINS: the sidebar Panel was hidden with a `hidden` class while collapsed, and the
 * collapsed icon rail was rendered as a direct child of `Group`.
 *
 * Both are wrong for the same underlying reason — `react-resizable-panels` owns the layout of its
 * children and writes `display`/`flex` INLINE, which beats any class. The hidden panel kept its
 * width, leaving a dead gap the width of the sidebar, and a non-Panel child of Group is not
 * positioned at all.
 *
 * A source-level assertion rather than a rendered one: there is no DOM in this test runner, and the
 * invariant ("Group contains only Panels and Separators, and no Panel is hidden by class") is
 * exactly what regressed.
 */
const shell = readFileSync(fileURLToPath(new URL('../client/app/AppShell.tsx', import.meta.url)), 'utf8');

test('no Panel is hidden with a class — the library writes display inline', () => {
  const panelTags = shell.match(/<Panel[\s\S]*?>/g) ?? [];
  assert.ok(panelTags.length >= 2, 'expected the shell to declare panels');
  for (const tag of panelTags) {
    assert.ok(!/className/.test(tag), `a Panel must not be styled by class: ${tag.slice(0, 60)}…`);
  }
});

test('Group contains only Panels and Separators', () => {
  const group = /<Group[^>]*>([\s\S]*?)<\/Group>/.exec(shell);
  assert.ok(group?.[1], 'expected a Group in the shell');
  // Any component rendered directly inside Group must be one the library lays out.
  const directComponents = group[1].matchAll(/^\s{10}<([A-Z][A-Za-z]*)/gm);
  for (const [, name] of directComponents) {
    assert.ok(
      ['Panel', 'ResizeHandle', 'Separator'].includes(name ?? ''),
      `${name} is rendered directly inside Group but the library only positions Panels/Separators`
    );
  }
});

test('the collapsed rail is a sibling of Group, not a child', () => {
  const group = /<Group[^>]*>([\s\S]*?)<\/Group>/.exec(shell);
  assert.ok(group?.[1]);
  assert.ok(
    !/collapsed\s*$/m.test(group[1]),
    'the collapsed ProjectSidebar must sit outside Group so it is laid out by plain flex'
  );
});

test('settings replaces the workspace rather than sitting beside it', () => {
  // The bug: only the sidebar was guarded, so `Group` kept its flex space while settings was open
  // and the chat/changes panels were squeezed into a sliver at the right edge. The two must be
  // branches of one ternary, never siblings.
  const branch = /\{settingsOpen \? \(([\s\S]*?)\) : \(/.exec(shell);
  assert.ok(branch?.[1], 'expected settingsOpen to choose between two branches');
  assert.match(branch[1], /<SettingsPage/, 'the settings branch should render the settings page');
  assert.ok(
    !branch[1].includes('<Group'),
    'the workspace must not render inside the settings branch'
  );
});

test('the settings page is told to fill its container', () => {
  const page = readFileSync(
    fileURLToPath(new URL('../client/features/settings/SettingsPage.tsx', import.meta.url)),
    'utf8'
  );
  // Without flex-1 it sizes to content and leaves the rest of the row empty.
  const root = /<div className="([^"]*)">/.exec(page)?.[1] ?? '';
  assert.match(root, /flex-1/, 'the settings root needs flex-1 to fill the shell');
});
