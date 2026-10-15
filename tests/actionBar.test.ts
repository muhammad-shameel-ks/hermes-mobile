import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyReaction,
  firstEmoji,
  formatElapsed,
  formatStamp,
  fullResponseText,
  planBars,
  reactionsFromMetadata,
  stablePlans,
  userReaction,
  withAgentReactions,
  type StampFormats,
} from '../src/chat/actionBar.ts';
import type { Message } from '../src/chat/transcript.ts';

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  parts: text ? [{ kind: 'text', text }] : [],
  status: 'complete',
  ...extra,
});

test('a user turn and its final reply carry a bar; the newest user turn takes Stop while running', () => {
  const messages = [msg('u1', 'user', 'one'), msg('a1', 'assistant', 'reply one'), msg('u2', 'user', 'two'), msg('a2', 'assistant', 'reply two', { status: 'streaming' })];
  const idle = planBars(messages, false);
  assert.deepEqual(idle.get('u1'), { kind: 'user', latest: false, stop: false });
  assert.deepEqual(idle.get('u2'), { kind: 'user', latest: true, stop: false });
  const busy = planBars(messages, true);
  assert.deepEqual(busy.get('u2'), { kind: 'user', latest: true, stop: true });
  assert.deepEqual(busy.get('u1'), { kind: 'user', latest: false, stop: false });
  assert.deepEqual(busy.get('a2'), { kind: 'assistant', live: true, fullAvailable: false });
});

test('interim replies carry no bar, and system notices and empty prompts none either', () => {
  const messages = [
    msg('u1', 'user', 'go'),
    msg('a1', 'assistant', 'let me look', { interim: true }),
    msg('a2', 'assistant', 'found it'),
    msg('s1', 'system', 'notice'),
    msg('u2', 'user', ''),
  ];
  const plans = planBars(messages, false);
  assert.equal(plans.has('a1'), false);
  assert.deepEqual(plans.get('a2'), { kind: 'assistant', live: false, fullAvailable: true });
  assert.equal(plans.has('s1'), false);
  assert.equal(plans.has('u2'), false);
});

test('a turn cut off after an interim keeps the bar on that interim once it is over', () => {
  const messages = [msg('u1', 'user', 'go'), msg('a1', 'assistant', 'partial', { interim: true })];
  assert.equal(planBars(messages, false).has('a1'), true);
  assert.equal(planBars(messages, true).has('a1'), false, 'while the turn runs the next reply may still arrive');
});

test('the full response joins every reply of the turn, and stops at the next prompt', () => {
  const messages = [
    msg('u1', 'user', 'go'),
    msg('a1', 'assistant', 'first', { interim: true }),
    msg('a2', 'assistant', 'second'),
    msg('u2', 'user', 'again'),
    msg('a3', 'assistant', 'third'),
  ];
  assert.equal(fullResponseText(messages, 'a2'), 'first\n\nsecond');
  assert.equal(fullResponseText(messages, 'a3'), 'third');
  assert.equal(fullResponseText(messages, 'missing'), '');
});

test('a plan keeps its identity until it changes', () => {
  const messages = [msg('u1', 'user', 'go'), msg('a1', 'assistant', 'hi')];
  const first = planBars(messages, false);
  const second = stablePlans(first, planBars(messages, false));
  assert.equal(second.get('a1'), first.get('a1'));
  const running = stablePlans(second, planBars(messages, true));
  assert.notEqual(running.get('u1'), second.get('u1'));
  assert.equal(running.get('a1'), second.get('a1'));
});

const formats: StampFormats = {
  clock: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }),
  dayTime: new Intl.DateTimeFormat('en-US', { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short' }),
};
const at = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute);

test('stamps read as a clock today, "Yesterday, …" a day back and a date beyond', () => {
  const now = at(30, 18, 0);
  const seconds = (date: Date) => date.getTime() / 1000;
  assert.equal(formatStamp(seconds(at(30, 15, 27)), now, formats).replace(/\s/g, ' '), '3:27 PM');
  assert.equal(formatStamp(seconds(at(29, 15, 27)), now, formats).replace(/\s/g, ' '), 'Yesterday, 3:27 PM');
  assert.equal(formatStamp(seconds(at(28, 15, 27)), now, formats).replace(/\s/g, ' '), 'Sep 28, 3:27 PM');
  assert.equal(formatStamp(undefined, now, formats), '');
  assert.equal(formatStamp(0, now, formats), '');
});

test('elapsed time reads in seconds, then minutes', () => {
  assert.equal(formatElapsed(42), '42s');
  assert.equal(formatElapsed(9), '9s');
  assert.equal(formatElapsed(65), '1:05');
  assert.equal(formatElapsed(75), '1:15');
});

test('a reaction is one per author, the same emoji retracts and null clears', () => {
  const heart = applyReaction(undefined, '❤️', 'user', 1);
  assert.deepEqual(heart, [{ emoji: '❤️', author: 'user', at: 1 }]);
  assert.equal(userReaction(heart), '❤️');
  const swapped = applyReaction(heart, '👍', 'user', 2);
  assert.deepEqual(swapped.map((r) => r.emoji), ['👍']);
  assert.deepEqual(applyReaction(swapped, '👍', 'user'), []);
  assert.deepEqual(applyReaction(swapped, null, 'user'), []);
  const both = applyReaction(applyReaction(undefined, '😂', 'agent', 1), '👍', 'user', 2);
  assert.deepEqual(both.map((r) => r.author).sort(), ['agent', 'user']);
});

test('an announced reaction list replaces the agent side and leaves the reader\'s own click', () => {
  const mine = [{ emoji: '👍', author: 'user' }, { emoji: '😂', author: 'agent' }];
  const next = withAgentReactions(mine, [{ emoji: '❓', author: 'agent' }, { emoji: '👎', author: 'user' }]);
  assert.deepEqual(next.map((r) => r.emoji), ['👍', '❓']);
});

test('reactions come out of display_metadata as an object or its JSON', () => {
  const reactions = [{ emoji: '👍', author: 'agent', at: 5 }, { nope: true }];
  assert.deepEqual(reactionsFromMetadata({ reactions }), [{ emoji: '👍', author: 'agent', at: 5 }]);
  assert.deepEqual(reactionsFromMetadata(JSON.stringify({ reactions })), [{ emoji: '👍', author: 'agent', at: 5 }]);
  assert.deepEqual(reactionsFromMetadata('not json'), []);
  assert.deepEqual(reactionsFromMetadata(undefined), []);
});

test('the first emoji of what was typed is taken whole', () => {
  assert.equal(firstEmoji('🎉'), '🎉');
  assert.equal(firstEmoji('  hi 🎉🎉'), '🎉');
  assert.equal(firstEmoji('❤️'), '❤️');
  assert.equal(firstEmoji('👍🏽'), '👍🏽');
  assert.equal(firstEmoji('👨‍👩‍👧'), '👨‍👩‍👧');
  assert.equal(firstEmoji('🇳🇴x'), '🇳🇴');
  assert.equal(firstEmoji('1️⃣'), '1️⃣');
  assert.equal(firstEmoji('7'), null);
  assert.equal(firstEmoji('hello'), null);
  assert.equal(firstEmoji(''), null);
});
