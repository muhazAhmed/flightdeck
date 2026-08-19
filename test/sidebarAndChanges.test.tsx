import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { Chat, Project } from '../shared/types.ts';
import { ChangesPanel } from '../client/features/changes/ChangesPanel.tsx';
import { ProjectSidebar } from '../client/features/projects/ProjectSidebar.tsx';
import { useWorkspace } from '../client/store/workspace.ts';

const project: Project = {
  id: 'flightdeck',
  name: 'flightdeck',
  path: 'E:\muhaz\flightdeck',
  addedAt: new Date(0).toISOString(),
  defaultPermissionMode: 'acceptEdits'
};

const second: Project = { ...project, id: 'other', name: 'other', path: 'E:\muhaz\other' };

const chat: Chat = {
  id: 'c1',
  projectId: 'flightdeck',
  parentChatId: null,
  title: 'New chat',
  sessionId: 's1',
  permissionMode: 'acceptEdits',
  createdAt: new Date(0).toISOString(),
  lastMessageAt: null
};

const noop = () => {};

function renderSidebar(projects: Project[], selectedId: string | null) {
  useWorkspace.setState({ selectedProjectId: selectedId, selectedChatId: null });
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <ProjectSidebar
        projects={projects}
        loading={false}
        chats={[chat]}
        runningChatIds={[]}
        collapsed={false}
        onCollapse={noop}
        onAddProject={noop}
        onRemoveProject={noop}
        onChatsChanged={noop}
        onCreateChat={noop}
        onImportSession={noop}
      />
    </Tooltip.Provider>
  );
}

test('the profile footer is one button, not a row with a small gear target', () => {
  const html = renderSidebar([project], null);
  // The footer button must contain the identity text, which is what makes the whole row the target.
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const footer = buttons.find((b) => b.includes('set user.email in git') || b.includes('No git identity'));
  assert.ok(footer, 'the identity block should live inside a button');
  // A nested button would swallow the outer click and is invalid markup.
  assert.ok(!/<button[\s\S]*<button/.test(footer), 'the footer must not nest a button inside the row');
});

test('the selected project is filled and marked, not just tinted', () => {
  // NOTE: selection cannot be driven through the store here — zustand v5 uses `getInitialState` as
  // its server snapshot, so `setState` has no effect during `renderToStaticMarkup`. The rendered
  // check is therefore that the marker slot exists; the branch itself is asserted from source.
  const html = renderSidebar([project, second], null);
  assert.match(html, /border-l-2/, 'each project row needs an edge slot for the selected marker');
  assert.ok(!html.includes('border-accent-bright'), 'nothing should look selected when nothing is');

  const source = readFileSync(
    fileURLToPath(new URL('../client/features/projects/ProjectSidebar.tsx', import.meta.url)),
    'utf8'
  );
  const branch = /isSelected\s*\?\s*'([^']*)'/.exec(source)?.[1] ?? '';
  assert.match(branch, /border-accent-bright/, 'the selected row needs an accent edge');
  assert.match(branch, /bg-accent-subtle/, 'the selected row needs a fill');
});

test('the profile initials are large enough to read', () => {
  const html = renderSidebar([project], null);
  // size-9 avatar with a filled accent: a faint 11px circle was the previous state.
  assert.match(html, /size-9[^"]*rounded-full[^"]*bg-accent/);
});

test('remote actions are labelled, not three unexplained arrows', () => {
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <ChangesPanel project={project} revision={0} confirmLevel="all" />
    </Tooltip.Provider>
  );
  for (const label of ['Fetch', 'Pull', 'Push']) {
    assert.ok(html.includes(`>${label}`), `${label} should be visible as text`);
  }
  // Each carries an explanation for anyone who has not memorised what fetch does.
  assert.match(html, /title="Check the remote for new commits/);
});

test('branch and identity are chips in the title row, ahead of the action row', () => {
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <ChangesPanel project={project} revision={0} confirmLevel="all" />
    </Tooltip.Provider>
  );
  const at = (needle: string) => html.indexOf(needle);
  // They are context, not actions: they belong in the title row's corner, and the full-width row
  // below stays for things you press.
  assert.ok(at('>Changes') < at('title="Branch:'), 'the branch chip should sit in the title row');
  assert.ok(at('title="Branch:') < at('>Fetch'), 'context chips come before the action row');
  assert.match(html, /max-w-28/, 'chips are width-capped so a long name cannot push the row apart');
});

test('the panel header has no settings gear, and branch and identity are buttons', () => {
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <ChangesPanel project={project} revision={0} confirmLevel="all" />
    </Tooltip.Provider>
  );
  // The gear opened nothing; the space is better spent on the branch control.
  assert.ok(!html.includes('Git settings'), 'the disabled gear should be gone');
  // Both are triggers styled like the remote row, so the whole header reads as one family.
  assert.match(html, /title="Branch: /);
  assert.ok(
    html.includes('No identity') || /Committing as/.test(html),
    'the identity control should render as a labelled button'
  );
});

test('counts are circular for one or two digits and coloured by meaning', () => {
  const html = renderToStaticMarkup(
    <Tooltip.Provider>
      <ChangesPanel project={project} revision={0} confirmLevel="all" />
    </Tooltip.Provider>
  );
  // `size-5` fixes both axes; horizontal padding is what made a single digit an oval.
  assert.match(html, /size-5[^"]*rounded-full|rounded-full[^"]*size-5/);
  // A zero count stays neutral — a filled badge is a call to attention.
  assert.match(html, /bg-surface-3[^"]*text-text-muted|text-text-muted[^"]*bg-surface-3/);
});

test('each badge tone maps to a fill that carries white text', () => {
  const tokens = readFileSync(fileURLToPath(new URL('../client/styles/tokens.css', import.meta.url)), 'utf8');
  const panel = readFileSync(
    fileURLToPath(new URL('../client/features/changes/ChangesPanel.tsx', import.meta.url)),
    'utf8'
  );
  const tones = /const BADGE_TONE[\s\S]*?\};/.exec(panel)?.[0] ?? '';
  assert.ok(tones, 'expected a tone map');
  // Every non-accent tone must use a `--fill-*` token, not a bright mark colour: white on the bright
  // variants (e.g. #22c55e) is about 2.3:1 and unreadable.
  for (const fill of [...tones.matchAll(/bg-(fill-[a-z]+)/g)].map(([, name]) => name)) {
    assert.match(tokens, new RegExp(`--${fill}:`), `${fill} has no token`);
  }
  assert.ok(!/bg-success|bg-warn\b|bg-info\b/.test(tones), 'badges must not use the bright mark colours');
});
