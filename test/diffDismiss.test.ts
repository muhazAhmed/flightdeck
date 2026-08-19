import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Closing an open diff.
 *
 * Reported as a question — "how do I go back?" — which is the worst kind of bug report to receive, because it
 * means the answer was "you cannot". Selecting a file opened the diff over half the panel, clicking the same row
 * again was a no-op, and nothing else cleared the selection: the only ways out were switching tabs or projects.
 *
 * Three ways out now, because people reach for different ones: the close button, a second click on the row, and
 * Escape.
 */
const changes = readFileSync('client/features/changes/ChangesPanel.tsx', 'utf8');
const history = readFileSync('client/features/changes/HistoryPanel.tsx', 'utf8');

test('the working-tree diff has a close button', () => {
  assert.match(changes, /label="Close the diff \(Esc\)"/);
  assert.match(changes, /onClick=\{\(\) => git\.select\(null\)\}/);
});

test('clicking the open file again closes it', () => {
  // A second click on a toggle means "off" everywhere else in this app; here it did nothing at all.
  assert.match(changes, /onClick=\{\(\) => onSelect\(isSelected \? null : \{ path: file\.path, staged \}\)\}/);
});

test('the file list can be told to select nothing', () => {
  // The prop type had to widen for any of this to typecheck — it previously could not express "deselect".
  assert.match(changes, /onSelect: \(file: SelectedFile \| null\) => void/);
});

test('Escape closes the diff', () => {
  assert.match(changes, /useHotkey\('Escape', \(\) => git\.select\(null\), \{ ctrl: false, inFields: true \}\)/);
});

test('the history diff can be closed too', () => {
  // The same trap existed there: the row toggled, but the pane had no affordance of its own.
  assert.match(history, /label="Close the diff"/);
  assert.match(history, /onClick=\{\(\) => history\.selectFile\(null\)\}/);
});

test('the global Escape still only returns to the workspace', () => {
  // Both handlers fire on the same keypress. The shell's one is a no-op while the workspace is already showing,
  // which is the only situation where the Changes panel is mounted — so they cannot fight.
  const shell = readFileSync('client/app/AppShell.tsx', 'utf8');
  assert.match(shell, /useHotkey\('Escape', \(\) => setView\('workspace'\)/);
});
