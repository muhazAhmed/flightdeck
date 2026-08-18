import test from 'node:test';
import assert from 'node:assert/strict';
import { replayLines } from '../server/transcript.ts';

const line = (record: unknown) => JSON.stringify(record);

const userText = (text: string) => line({ type: 'user', message: { role: 'user', content: text } });

const assistant = (content: unknown[]) => line({ type: 'assistant', message: { role: 'assistant', content } });

const toolResult = (id: string, content: string, isError = false) =>
  line({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }
  });

test('a conversation replays as prompt, text and tool events in order', () => {
  const events = replayLines([
    userText('add a greeting'),
    assistant([{ type: 'text', text: 'Reading the file.' }, { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.ts' } }]),
    toolResult('tu_1', 'file contents'),
    assistant([{ type: 'text', text: 'Done.' }])
  ]);

  assert.deepEqual(
    events.map((e) => e.type),
    ['prompt', 'text', 'tool_start', 'tool_result', 'text']
  );
});

test('tool calls keep their id so results attach to the right card', () => {
  const events = replayLines([
    assistant([{ type: 'tool_use', id: 'tu_42', name: 'Bash', input: { command: 'ls' } }]),
    toolResult('tu_42', 'a.ts\nb.ts')
  ]);
  const start = events.find((e) => e.type === 'tool_start');
  const result = events.find((e) => e.type === 'tool_result');
  assert.equal(start?.type === 'tool_start' && start.id, 'tu_42');
  assert.equal(result?.type === 'tool_result' && result.id, 'tu_42');
});

test('an errored tool result is marked as such', () => {
  const events = replayLines([toolResult('tu_1', 'command not found', true)]);
  const [result] = events;
  assert.equal(result?.type === 'tool_result' && result.isError, true);
});

test('synthetic user entries are not replayed as things the user typed', () => {
  const events = replayLines([
    userText('<command-name>/clear</command-name>'),
    userText('<system-reminder>be careful</system-reminder>'),
    userText('<local-command-stdout>ok</local-command-stdout>'),
    userText('   '),
    userText('a real question')
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type === 'prompt' && events[0].text, 'a real question');
});

test('subagent sidechains are skipped — the parent shows one Task card instead', () => {
  const events = replayLines([
    line({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'inner work' }] } }),
    assistant([{ type: 'text', text: 'outer work' }])
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type === 'text' && events[0].delta, 'outer work');
});

test('malformed and unknown lines are ignored rather than throwing', () => {
  assert.deepEqual(replayLines(['', 'not json', line({ type: 'summary' }), line({ type: 'user' })]), []);
});

test('array content with text blocks is flattened', () => {
  const events = replayLines([
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }] } })
  ]);
  assert.equal(events[0]?.type === 'prompt' && events[0].text, 'part one part two');
});
