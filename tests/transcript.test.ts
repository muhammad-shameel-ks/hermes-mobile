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

test('history carries each prompt\'s row id and reactions; a turn answers to its last reply row', () => {
  const messages = fromHistory([
    { role: 'user', content: 'go', id: 1, display_metadata: { reactions: [{ emoji: '👍', author: 'agent' }] } },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c', function: { name: 'read', arguments: {} } }], id: 2 },
    { role: 'tool', tool_call_id: 'c', tool_name: 'read', content: 'x', id: 3 },
    { role: 'assistant', content: 'done', id: 4, display_metadata: JSON.stringify({ reactions: [{ emoji: '❤️', author: 'user' }] }) },
  ]);
  assert.equal(messages[0].rowId, 1);
  assert.deepEqual(messages[0].reactions, [{ emoji: '👍', author: 'agent' }]);
  assert.equal(messages[1].rowId, 4);
  assert.deepEqual(messages[1].reactions, [{ emoji: '❤️', author: 'user' }]);
  assert.equal(messages[1].id, 'row-2', 'the message id still keys on its first row');
});

test('an announced reaction lands on the row it names and keeps the reader\'s own', () => {
  const [user, reply] = fromHistory([
    { role: 'user', content: 'go', id: 1, display_metadata: { reactions: [{ emoji: '👍', author: 'user' }] } },
    { role: 'assistant', content: 'hi', id: 2 },
  ]);
  const state: Transcript = { ...emptyTranscript(), messages: [user, reply] };
  const next = applyEvent(state, {
    type: 'message.reaction',
    payload: { row_id: 1, role: 'user', reactions: [{ emoji: '👍', author: 'user' }, { emoji: '😂', author: 'agent' }] },
  });
  assert.deepEqual(next.messages[0].reactions?.map((r) => r.emoji), ['👍', '😂']);
  assert.equal(next.messages[1], reply);
  assert.equal(applyEvent(state, { type: 'message.reaction', payload: { row_id: 99, reactions: [] } }), state);
});

test('a finished live turn is stamped with how long it ran', () => {
  const sent = addUserMessage(emptyTranscript(), 'go');
  sent.messages[0].timestamp = Math.floor(Date.now() / 1000) - 12;
  const done = play(
    [
      { type: 'message.delta', payload: { text: 'hi' } },
      { type: 'message.complete', payload: { status: 'complete' } },
    ],
    sent,
  );
  const duration = done.messages[1].durationS;
  assert.ok(duration !== undefined && duration >= 12 && duration <= 14);
});

// ─── cost of a streamed delta ────────────────────────────────────────────────

function longTranscript(count: number): Transcript {
  const messages = fromHistory(
    Array.from({ length: count }, (_, i) => [
      { role: 'user' as const, content: `question ${i}`, id: i * 2 + 1 },
      { role: 'assistant' as const, content: `answer ${i}`, id: i * 2 + 2 },
    ]).flat(),
  );
  return { ...emptyTranscript(), messages };
}

test('a delta replaces only the live message: every other message and part keeps its identity', () => {
  const settled = longTranscript(50);
  const started = applyEvent(settled, { type: 'message.start', payload: {} });
  const first = applyEvent(started, { type: 'reasoning.delta', payload: { text: 'hmm' } });
  const second = applyEvent(first, { type: 'message.delta', payload: { text: 'Hel' } });
  const third = applyEvent(second, { type: 'message.delta', payload: { text: 'lo' } });

  settled.messages.forEach((message, i) => assert.equal(third.messages[i], message, `message ${i} is the same object`));
  const live = third.messages.at(-1)!;
  assert.deepEqual(live.parts, [
    { kind: 'reasoning', text: 'hmm' },
    { kind: 'text', text: 'Hello' },
  ]);
  // a text delta leaves the reasoning part it did not touch alone
  assert.equal(third.messages.at(-1)!.parts[0], second.messages.at(-1)!.parts[0]);
  // and the transcript a delta was applied to is never mutated
  assert.deepEqual(second.messages.at(-1)!.parts[1], { kind: 'text', text: 'Hel' });
});

test('a delta looks at the live message, not at the transcript: the work does not grow with its length', () => {
  const reads = { count: 0 };
  const counted = (message: Transcript['messages'][number]) =>
    new Proxy(message, {
      get(target, key, receiver) {
        if (key === 'id') reads.count += 1;
        return Reflect.get(target, key, receiver);
      },
    });
  const base = longTranscript(2_000);
  let state: Transcript = { ...base, messages: base.messages.map(counted) };
  state = applyEvent(state, { type: 'message.start', payload: {} });
  reads.count = 0;
  for (let i = 0; i < 500; i += 1) state = applyEvent(state, { type: 'message.delta', payload: { text: 'x' } });
  assert.equal(reads.count, 0, 'no settled message is ever inspected while the live one streams');
  const live = state.messages.at(-1)!;
  assert.equal(live.parts[0].kind === 'text' && live.parts[0].text.length, 500);
});

test('an event that changes nothing hands the same transcript back', () => {
  const streaming = play([
    { type: 'message.start', payload: {} },
    { type: 'reasoning.available', payload: { text: 'already thinking' } },
  ]);
  assert.equal(applyEvent(streaming, { type: 'message.delta', payload: { text: '' } }), streaming);
  assert.equal(applyEvent(streaming, { type: 'reasoning.available', payload: { text: 'again' } }), streaming);
  assert.equal(applyEvent(streaming, { type: 'status.update', payload: { kind: 'unrelated' } }), streaming);
});

test('a tool result lands on the newest matching running call without touching older messages', () => {
  const before = longTranscript(20);
  const state = play(
    [
      { type: 'message.start', payload: {} },
      { type: 'tool.start', payload: { tool_id: 't1', name: 'terminal', context: 'ls' } },
      { type: 'tool.complete', payload: { tool_id: 't1', name: 'terminal', result_text: 'ok' } },
    ],
    before,
  );
  before.messages.forEach((message, i) => assert.equal(state.messages[i], message));
  const tool = state.messages.at(-1)!.parts[0];
  assert.equal(tool.kind === 'tool' && tool.status, 'done');
});
