import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { Chat, Project } from '../shared/types.ts';
import { ProjectSidebar } from '../client/features/projects/ProjectSidebar.tsx';

/**
 * Deleting a chat, and sending one.
 *
 * The render test here exists because of a specific failure: a change added `onConfirm={setConfirm}` to a chat
 * row without declaring the state or rendering the dialog. `tsc` caught it, but the dev server does not
 * typecheck — esbuild strips types and serves the file — so the app went to a blank screen with a
 * ReferenceError. Rendering the sidebar with a chat in it fails loudly on that class of mistake.
 */
const project: Project = {
  id: 'p1',
  name: 'demo',
  path: '/repos/demo',
  addedAt: new Date(0).toISOString(),
  defaultPermissionMode: 'acceptEdits'
};

const chat: Chat = {
  id: 'c1',
  projectId: 'p1',
  parentChatId: null,
  title: 'Rate limiting',
  sessionId: 's1',
  permissionMode: 'acceptEdits',
  createdAt: new Date(0).toISOString(),
  lastMessageAt: new Date(0).toISOString()
};

const noop = () => {};

function renderSidebar(chats: Chat[]) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <ProjectSidebar
        projects={[project]}
        loading={false}
        chats={chats}
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

const sidebar = readFileSync(
  fileURLToPath(new URL('../client/features/projects/ProjectSidebar.tsx', import.meta.url)),
  'utf8'
);
const prompt = readFileSync(
  fileURLToPath(new URL('../client/features/chat/PromptInput.tsx', import.meta.url)),
  'utf8'
);

test('the sidebar renders with chats in it', () => {
  // The blank-screen regression: this throws if a row references something that does not exist.
  const html = renderSidebar([chat]);
  assert.match(html, />demo</);
});

test('the sidebar renders with a sub-chat too', () => {
  const html = renderSidebar([chat, { ...chat, id: 'c2', parentChatId: 'c1', title: 'Sub' }]);
  assert.ok(html.length > 0);
});

test('deleting a chat asks first instead of deleting on click', () => {
  // The trash icon is revealed on hover, one row from the chat being read — a misclick used to be instant.
  assert.match(sidebar, /onClick=\{confirmDelete\}/);
  assert.ok(!/onClick=\{\(\) => void remove\(\)\}/.test(sidebar), 'the trash icon must not delete directly');
});

test('the confirmation dialog is actually rendered, with state behind it', () => {
  // Passing a setter that does not exist is exactly what blanked the screen.
  assert.match(sidebar, /const \[confirm, setConfirm\] = useState<ConfirmRequest \| null>\(null\)/);
  assert.match(sidebar, /<ConfirmDialog request=\{confirm\} onClose=\{\(\) => setConfirm\(null\)\}/);
});

test('the dialog names the consequences that are not obvious', () => {
  // A running agent being stopped, and sub-chats going with the parent, are both invisible from the row.
  assert.match(sidebar, /will be stopped/);
  assert.match(sidebar, /sub-chat/);
  // And the reassuring part: the CLI keeps the transcript, so this is recoverable.
  assert.match(sidebar, /can be imported back/);
});

test('Enter sends the prompt', () => {
  assert.match(prompt, /event\.preventDefault\(\);\s*\n\s*submit\(\);/);
  // Shift or Alt means a newline, so those return before the send.
  assert.match(prompt, /if \(event\.shiftKey \|\| event\.altKey\) return;/);
});

test('an IME composition Enter never sends', () => {
  // Confirming a candidate would otherwise swallow the word being typed — the one Enter with no intent.
  assert.match(prompt, /event\.nativeEvent\.isComposing\) return;/);
  const handler = prompt.slice(prompt.indexOf('function onKeyDown'));
  const body = handler.slice(0, handler.indexOf('\n  }'));
  assert.ok(
    body.indexOf('isComposing') < body.indexOf('submit()'),
    'the composition guard must come before the send'
  );
});

test('the hint tells you the shortcut that is not discoverable', () => {
  // Enter sending is learned on the first message; Shift+Enter has to be said.
  assert.match(prompt, /for a new line/);
  assert.match(prompt, />Shift</);
});

test('the commit box still sends on Ctrl+Enter, because commit bodies are multi-line', () => {
  const changes = readFileSync(
    fileURLToPath(new URL('../client/features/changes/ChangesPanel.tsx', import.meta.url)),
    'utf8'
  );
  assert.match(changes, /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\)/);
});
