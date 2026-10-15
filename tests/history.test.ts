import assert from 'node:assert/strict';
import { test } from 'node:test';

import { graftTail, historyFromPage, joinTurn, NO_HISTORY, prependOlder, unhideOpeningUserRows } from '../src/chat/history.ts';
import { fromHistory, type Message, type SessionMessage } from '../src/chat/transcript.ts';

const rows = (from: number, to: number): SessionMessage[] => {
  const out: SessionMessage[] = [];
  for (let id = from; id <= to; id += 1) out.push({ id, role: id % 2 === 1 ? 'user' : 'assistant', content: `m${id}` });
  return out;
};
const ids = (messages: Message[]) => messages.map((m) => m.id);
const page = (messages: SessionMessage[], offset: number, limit = 4, order = 'latest') => ({ messages, pagination: { limit, offset, order } });

test('a full latest page leaves older rows to page and the next offset counts back from the newest', () => {
  assert.deepEqual(historyFromPage(page(rows(7, 10), 0)), { nextOffset: 4, more: true, loadingEarlier: false });
  assert.deepEqual(historyFromPage(page(rows(5, 8), 4)), { nextOffset: 8, more: true, loadingEarlier: false });
  assert.deepEqual(historyFromPage(page(rows(1, 3), 8)), { nextOffset: 11, more: false, loadingEarlier: false });
});

test('a page without paging metadata, or without the latest-order echo, is the whole transcript', () => {
  assert.equal(historyFromPage({ messages: rows(1, 10) }).more, false);
  assert.equal(historyFromPage(page(rows(1, 4), 0, 4, 'oldest')).more, false);
});

test('an empty read does not disarm a truncated tail', () => {
  const armed = { nextOffset: 120, more: true, loadingEarlier: false };
  assert.equal(historyFromPage(page([], 120), armed).more, true);
  assert.equal(historyFromPage(page([], 0), NO_HISTORY).more, false);
});

test('the opening user row that compaction hid comes back', () => {
  const [first, second] = unhideOpeningUserRows([
    { id: 1, role: 'user', content: 'hello', display_kind: 'hidden' },
    { id: 2, role: 'user', content: 'again', display_kind: 'hidden' },
  ]);
  assert.equal(first.display_kind, undefined);
  assert.equal(first.display_content, 'hello');
  assert.equal(second.display_kind, 'hidden');
  const untouched = [{ id: 1, role: 'user' as const, content: '', display_kind: 'hidden' }];
  assert.equal(unhideOpeningUserRows(untouched), untouched);
});

test('an older page goes in front and skips what is already held', () => {
  const held = fromHistory(rows(5, 8));
  const merged = prependOlder(held, fromHistory(rows(3, 6)));
  assert.deepEqual(ids(merged), ['row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-8']);
  assert.equal(prependOlder(held, fromHistory(rows(5, 8))), held);
  assert.equal(prependOlder([], fromHistory(rows(1, 2))).length, 0);
});

test('a turn split by the page boundary is joined, and an orphan result completes its call', () => {
  const older = fromHistory([
    { id: 1, role: 'user', content: 'go' },
    { id: 2, role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"path":"a"}' } }] },
  ]);
  const held = fromHistory([
    { id: 3, role: 'tool', tool_call_id: 'c1', tool_name: 'read', content: 'file a' },
    { id: 4, role: 'assistant', content: 'done' },
    { id: 5, role: 'user', content: 'thanks' },
  ]);
  const merged = prependOlder(held, older);
  assert.deepEqual(ids(merged), ['row-1', 'row-2', 'row-5']);
  const turn = merged[1];
  assert.deepEqual(turn.parts.map((p) => p.kind), ['tool', 'text']);
  const tool = turn.parts[0];
  assert.equal(tool.kind === 'tool' && tool.result, 'file a');
  assert.equal(tool.kind === 'tool' && tool.args.path, 'a');
});

test('joining drops parts both halves carry', () => {
  const a = fromHistory([{ id: 1, role: 'assistant', content: 'one', reasoning: 'why' }])[0];
  const b = fromHistory([{ id: 2, role: 'assistant', content: 'one', reasoning: 'why' }, { id: 3, role: 'assistant', content: 'two' }])[0];
  assert.deepEqual(joinTurn(a, b).parts.map((p) => (p.kind === 'tool' ? p.id : p.text)), ['why', 'one', 'two']);
});

test('a refreshed newest page keeps the older pages the reader pulled in', () => {
  const previous = fromHistory(rows(1, 8));
  const refreshed = fromHistory(rows(5, 10));
  assert.deepEqual(ids(graftTail(previous, refreshed)), ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-8', 'row-9', 'row-10']);
});

test('a refreshed page that covers what is held replaces it', () => {
  const previous = fromHistory(rows(5, 8));
  const refreshed = fromHistory(rows(1, 10));
  assert.equal(graftTail(previous, refreshed), refreshed);
});

test('a page sharing nothing with the held transcript replaces it', () => {
  const previous = fromHistory(rows(1, 4));
  const refreshed = fromHistory(rows(20, 24));
  assert.equal(graftTail(previous, refreshed), refreshed);
});

test('a refresh that starts inside a held turn does not duplicate it', () => {
  const previous = fromHistory([
    { id: 1, role: 'user', content: 'go' },
    { id: 2, role: 'assistant', content: 'first' },
    { id: 3, role: 'assistant', content: 'second' },
    { id: 4, role: 'user', content: 'next' },
  ]);
  const refreshed = fromHistory([
    { id: 3, role: 'assistant', content: 'second' },
    { id: 4, role: 'user', content: 'next' },
    { id: 5, role: 'assistant', content: 'reply' },
  ]);
  const grafted = graftTail(previous, refreshed);
  assert.deepEqual(ids(grafted), ['row-1', 'row-2', 'row-4', 'row-5']);
  assert.deepEqual(grafted[1].parts.map((p) => (p.kind === 'text' ? p.text : '')), ['first', 'second']);
});
