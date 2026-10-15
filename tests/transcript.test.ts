import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addUserMessage,
  applyEvent,
  emptyTranscript,
  fromHistory,
  textOf,
  type LiveEvent,
  type Transcript,
} from '../src/chat/transcript.ts';

const play = (events: LiveEvent[], start: Transcript = emptyTranscript()) => events.reduce(applyEvent, start);

test('history merges a turn into one assistant message and pairs tool results', () => {
  const messages = fromHistory([
    { role: 'user', content: 'list files', id: 1 },
    {
      role: 'assistant',
      content: '',
      reasoning: 'need ls',
      tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"ls -la"}' } }],
      id: 2,
    },
    { role: 'tool', tool_call_id: 'c1', tool_name: 'terminal', content: 'a.txt\nb.txt', id: 3 },
    { role: 'assistant', content: 'Two files.', id: 4 },
    { role: 'user', content: 'thanks', id: 5 },
  ]);
  assert.equal(messages.length, 3);
  assert.deepEqual(
    messages[1].parts.map((p) => p.kind),
    ['reasoning', 'tool', 'text'],
  );
  const tool = messages[1].parts[1];
  assert.equal(tool.kind === 'tool' && tool.context, 'ls -la');
  assert.equal(tool.kind === 'tool' && tool.status, 'done');
  assert.equal(tool.kind === 'tool' && tool.result, 'a.txt\nb.txt');
});

test('a reused tool-call id only pairs with the unresolved call', () => {
  const [, turn] = fromHistory([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'read', arguments: {} } }] },
    { role: 'tool', tool_call_id: 'x', content: 'first' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'read', arguments: {} } }] },
    { role: 'tool', tool_call_id: 'x', content: 'second' },
  ]);
  const results = turn.parts.flatMap((p) => (p.kind === 'tool' ? [p.result] : []));
  assert.deepEqual(results, ['first', 'second']);
});

test('hidden rows and empty content are skipped; content parts are read', () => {
  const messages = fromHistory([
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'system', content: 'internal', display_kind: 'hidden' },
    { role: 'assistant', content: '   ' },
  ]);
  assert.equal(messages.length, 1);
  assert.equal(textOf([{ type: 'text', text: 'a' }, 'b']), 'a\nb');
});

test('a streamed turn: reasoning, text, a tool, more text, complete', () => {
  const state = play(
    [
      { type: 'message.start', payload: {} },
      { type: 'reasoning.delta', payload: { text: 'thinking ' } },
      { type: 'reasoning.delta', payload: { text: 'more' } },
      { type: 'message.delta', payload: { text: 'Let me ' } },
      { type: 'message.delta', payload: { text: 'check.' } },
      { type: 'tool.start', payload: { tool_id: 't1', name: 'read_file', args: { path: 'README.md' } } },
      { type: 'tool.complete', payload: { tool_id: 't1', name: 'read_file', summary: 'Read 40 lines', duration_s: 0.4 } },
      { type: 'message.delta', payload: { text: 'Done.' } },
      { type: 'message.complete', payload: { status: 'complete', text: 'Let me check.Done.' } },
    ],
    addUserMessage(emptyTranscript(), 'read it'),
  );
  assert.equal(state.running, false);
  assert.equal(state.liveId, null);
  const reply = state.messages[1];
  assert.equal(reply.status, 'complete');
  assert.deepEqual(
    reply.parts.map((p) => (p.kind === 'tool' ? `tool:${p.status}:${p.summary}` : `${p.kind}:${p.text}`)),
    ['reasoning:thinking more', 'text:Let me check.', 'tool:done:Read 40 lines', 'text:Done.'],
  );
});

test('a null delta starts a new text segment', () => {
  const state = play([
    { type: 'message.delta', payload: { text: 'one' } },
    { type: 'message.delta', payload: { text: null } },
    { type: 'message.delta', payload: { text: 'two' } },
  ]);
  assert.deepEqual(
    state.messages[0].parts.map((p) => p.kind === 'text' && p.text),
    ['one', 'two'],
  );
});

test('an interim reply is sealed and the next delta opens a new bubble', () => {
  const state = play([
    { type: 'message.start', payload: {} },
    { type: 'message.delta', payload: { text: 'On it.' } },
    { type: 'message.interim', payload: { text: 'On it.', already_streamed: true } },
    { type: 'message.delta', payload: { text: 'Finished.' } },
  ]);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0].interim, true);
  assert.equal(state.messages[0].status, 'complete');
  assert.equal(state.messages[1].status, 'streaming');
});

test('complete carries the final text when nothing streamed, and errors and interrupts', () => {
  const quiet = play([{ type: 'message.complete', payload: { text: 'Hello' } }]);
  assert.equal(quiet.messages[0].parts[0].kind === 'text' && quiet.messages[0].parts[0].text, 'Hello');

  const failed = play([
    { type: 'message.start', payload: {} },
    { type: 'tool.start', payload: { tool_id: 't', name: 'x' } },
    { type: 'message.complete', payload: { status: 'error', error: 'rate limited' } },
  ]);
  assert.equal(failed.messages[0].status, 'error');
  assert.equal(failed.messages[0].error, 'rate limited');
  const tool = failed.messages[0].parts[0];
  assert.equal(tool.kind === 'tool' && tool.status, 'done', 'no spinner survives the turn');

  const stopped = play([
    { type: 'message.delta', payload: { text: 'partial' } },
    { type: 'message.complete', payload: { status: 'interrupted' } },
  ]);
  assert.equal(stopped.messages[0].status, 'interrupted');
});

test('session.info running:false is the authoritative busy-clear', () => {
  const state = play([
    { type: 'message.delta', payload: { text: 'x' } },
    { type: 'session.info', payload: { running: false } },
  ]);
  assert.equal(state.running, false);
  assert.equal(state.messages[0].status, 'complete');
});
