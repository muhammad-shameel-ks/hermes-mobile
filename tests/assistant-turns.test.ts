import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assistantTurns, replyPhase } from '../src/assistant/turns.ts';
import type { Message, Part } from '../src/chat/transcript.ts';

const user = (id: string, text: string): Message => ({ id, role: 'user', parts: [{ kind: 'text', text }], status: 'complete' });
const reply = (id: string, parts: Part[], status: Message['status'] = 'complete', error?: string): Message => ({ id, role: 'assistant', parts, status, error });
const text = (value: string): Part => ({ kind: 'text', text: value });
const tool = (name: string, status: 'running' | 'done'): Part => ({ kind: 'tool', id: name, name, context: '', args: {}, status });

test('a prompt just sent waits for the turn, and the edge reads as thinking', () => {
  const messages = [user('u1', 'weather?')];
  assert.deepEqual(assistantTurns(messages, false), [{ id: 'u1', prompt: 'weather?', reply: '', state: 'waiting', activity: 'Thinking', error: null }]);
  assert.equal(replyPhase(messages, false), 'thinking');
});

test('a running tool names its verb until the reply text starts streaming', () => {
  const working = [user('u1', 'list files'), reply('a1', [{ kind: 'reasoning', text: 'hmm' }, tool('terminal', 'running')], 'streaming')];
  const [turn] = assistantTurns(working, true);
  assert.equal(turn.state, 'working');
  assert.equal(turn.activity, 'Running');
  assert.equal(replyPhase(working, true), 'thinking');

  const streaming = [user('u1', 'list files'), reply('a1', [tool('terminal', 'done'), text('Here they are')], 'streaming')];
  const [live] = assistantTurns(streaming, true);
  assert.equal(live.state, 'streaming');
  assert.equal(live.activity, '');
  assert.equal(live.reply, 'Here they are');
  assert.equal(replyPhase(streaming, true), 'responding');
});

test('text split by tools and across a turn’s messages joins into one reply per prompt', () => {
  const messages = [
    user('u1', 'first'),
    reply('a1', [text('Looking.'), tool('read_file', 'done'), text('  '), text('Found it.')]),
    reply('a2', [text('Done.')]),
    user('u2', 'second'),
    reply('a3', [text('Sure.')]),
  ];
  const turns = assistantTurns(messages, false);
  assert.deepEqual(
    turns.map((turn) => [turn.prompt, turn.reply, turn.state]),
    [
      ['first', 'Looking.\n\nFound it.\n\nDone.', 'done'],
      ['second', 'Sure.', 'done'],
    ],
  );
  assert.equal(replyPhase(messages, false), 'idle');
});

test('a finished turn with no text is done, not waiting', () => {
  const [turn] = assistantTurns([user('u1', 'touch a file'), reply('a1', [tool('write_file', 'done')])], false);
  assert.equal(turn.state, 'done');
  assert.equal(turn.activity, '');
});

test('a failed reply carries its error and is never shown as live', () => {
  const [turn] = assistantTurns([user('u1', 'hi'), reply('a1', [], 'error', 'Provider unavailable')], true);
  assert.equal(turn.state, 'failed');
  assert.equal(turn.error, 'Provider unavailable');
});

test('a reply edited into a new message object is re-read, the old one keeps its text', () => {
  const before = reply('a1', [text('Hel')], 'streaming');
  const after = reply('a1', [text('Hello')], 'streaming');
  assert.equal(assistantTurns([user('u1', 'hi'), before], true)[0].reply, 'Hel');
  assert.equal(assistantTurns([user('u1', 'hi'), after], true)[0].reply, 'Hello');
  assert.equal(assistantTurns([user('u1', 'hi'), before], true)[0].reply, 'Hel');
});
