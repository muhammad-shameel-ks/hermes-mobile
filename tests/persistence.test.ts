import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DRAFT_KEY, REPLAY_GAP_NOTICE } from '../src/chat/controller.ts';
import { HISTORY_LIMIT } from '../src/chat/history.ts';
import type { SessionMessage } from '../src/chat/transcript.ts';
import { ApiError } from '../src/gateway/api.ts';
import { persistenceOver } from '../src/store/index.ts';
import { SESSION_STATE_LRU } from '../src/store/lru.ts';
import { flush, rig } from './support/gateway.ts';
import { memoryDb } from './support/sqlite.ts';

const rows = (from: number, to: number): SessionMessage[] => {
  const out: SessionMessage[] = [];
  for (let id = from; id <= to; id += 1) out.push({ id, role: id % 2 === 1 ? 'user' : 'assistant', content: `m${id}` });
  return out;
};

/** a server holding `total` rows, answering the way /messages does: offsets count back from the newest row */
function server(total: number) {
  const calls: Array<Record<string, unknown>> = [];
  const get = (_path: string, query: Record<string, unknown>) => {
    calls.push(query);
    const limit = Number(query.limit);
    const offset = Number(query.offset ?? 0);
    if (query.order === 'oldest') return { messages: rows(1 + offset, Math.min(total, offset + limit)), pagination: { limit, offset, order: 'oldest' } };
    const to = total - offset;
    return { messages: rows(Math.max(1, to - limit + 1), to), pagination: { limit, offset, order: 'latest' } };
  };
  return { get, calls };
}

const text = (m: { parts: Array<{ kind: string; text?: string }> }) => m.parts.map((p) => p.text ?? '').join('');

test('a session paints its warm tail while the server is still answering, then reconciles', async () => {
  const db = await memoryDb();
  const persistence = persistenceOver(async () => db, 'c1');
  await persistence.tails.save('default', 's1', [{ id: 'row-1', role: 'user', parts: [{ kind: 'text', text: 'cached' }], status: 'complete' }]);
  let answer!: (value: unknown) => void;
  const pending = new Promise((resolve) => (answer = resolve));
  const { controller, snap } = await rig(() => pending, persistence);

  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  assert.equal(snap().entries.s1.loading, true);
  assert.equal(text(snap().entries.s1.transcript.messages[0]), 'cached');

  answer({ messages: rows(1, 2), pagination: { limit: HISTORY_LIMIT, offset: 0, order: 'latest' } });
  await flush();
  assert.equal(snap().entries.s1.loading, false);
  assert.deepEqual(snap().entries.s1.transcript.messages.map(text), ['m1', 'm2']);
  controller.dispose();
});

test('a settled transcript is written to the warm tail', async () => {
  const db = await memoryDb();
  const persistence = persistenceOver(async () => db, 'c1');
  const { controller } = await rig(server(6).get, persistence);
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  await persistence.flush();
  const tail = await persistence.tails.load('default', 's1');
  assert.deepEqual(tail?.map(text), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  controller.dispose();
});

test('Show earlier pages the rows older than the held page and retires itself at the top', async () => {
  const { get, calls } = server(300);
  const { controller, snap } = await rig(get);
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  assert.equal(snap().entries.s1.history.more, true);
  assert.equal(snap().entries.s1.history.nextOffset, 120);
  assert.equal(snap().entries.s1.transcript.messages.length, 120);

  await controller.showEarlier('s1');
  assert.deepEqual(calls.at(-1), { limit: 120, offset: 120, order: 'latest', include_compacted: true, profile: 'default' });
  assert.equal(snap().entries.s1.transcript.messages.length, 240);
  assert.equal(text(snap().entries.s1.transcript.messages[0]), 'm61');
  assert.equal(snap().entries.s1.history.nextOffset, 240);

  await controller.showEarlier('s1');
  assert.equal(snap().entries.s1.transcript.messages.length, 300);
  assert.equal(snap().entries.s1.history.more, false);
  const before = calls.length;
  await controller.showEarlier('s1');
  assert.equal(calls.length, before, 'nothing left to ask for');
  controller.dispose();
});

test('a session with fewer rows than a page offers no earlier history', async () => {
  const { controller, snap } = await rig(server(40).get);
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  assert.equal(snap().entries.s1.history.more, false);
  controller.dispose();
});

test('a replay gap reloads the history, keeps the older pages and says so in the transcript', async () => {
  const { get } = server(300);
  const { controller, gateway, snap } = await rig(get);
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  await controller.showEarlier('s1');
  assert.equal(snap().entries.s1.transcript.messages.length, 240);

  gateway.event('session.replay_gap', 'rt-s1');
  await flush();
  const messages = snap().entries.s1.transcript.messages;
  assert.equal(messages.length, 241, 'the older page survives the reload, plus the notice');
  const notice = messages.at(-1);
  assert.equal(notice?.role, 'system');
  assert.equal(text(notice!), REPLAY_GAP_NOTICE);
  assert.equal(text(messages[0]), 'm61');
  controller.dispose();
});

test('a session the server says is gone falls back to a fresh chat and keeps the unsent text', async () => {
  const persistence = persistenceOver(async () => memoryDb(), 'c1');
  const { controller, snap } = await rig(() => {
    throw new ApiError('GET', '/api/sessions/dead/messages', 404, 'Session not found');
  }, persistence);
  controller.drafts.set('default', 'dead', 'half typed');
  controller.openSession({ id: 'dead', title: 'Dead' });
  await flush();
  assert.equal(snap().openKey, DRAFT_KEY);
  assert.equal(snap().entries.dead, undefined);
  assert.equal(controller.drafts.get('default', DRAFT_KEY), 'half typed');
  assert.equal(controller.drafts.getRestored()?.fromKey, 'dead');
  controller.dispose();
});

test('a failing read other than a missing session keeps the entry and the cached tail', async () => {
  const db = await memoryDb();
  const persistence = persistenceOver(async () => db, 'c1');
  await persistence.tails.save('default', 's1', [{ id: 'row-1', role: 'user', parts: [{ kind: 'text', text: 'cached' }], status: 'complete' }]);
  const { controller, snap } = await rig(() => {
    throw new Error('network down');
  }, persistence);
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  assert.equal(snap().openKey, 's1');
  assert.match(snap().entries.s1.error ?? '', /network down/);
  assert.equal(text(snap().entries.s1.transcript.messages[0]), 'cached');
  assert.notEqual(await persistence.tails.load('default', 's1'), null);
  controller.dispose();
});

test('settled sessions beyond the cap are released, the open one and the draft never', async () => {
  const { controller, snap } = await rig(server(4).get);
  const total = SESSION_STATE_LRU + 4;
  for (let i = 0; i < total; i += 1) {
    controller.openSession({ id: `s${i}`, title: `S${i}` });
    await flush();
  }
  const keys = Object.keys(snap().entries);
  assert.equal(keys.length, SESSION_STATE_LRU + 2, 'the cap plus the open session and the draft');
  assert.ok(keys.includes(DRAFT_KEY));
  assert.ok(keys.includes(`s${total - 1}`));
  assert.ok(!keys.includes('s0'));
  assert.ok(keys.includes('s4'), 'the most recent twelve stay');

  controller.openSession({ id: 's0', title: 'S0' });
  await flush();
  assert.equal(snap().entries.s0.transcript.messages.length, 4, 'a released session reloads when opened again');
  controller.dispose();
});

test('a running session is never released', async () => {
  const { controller, gateway, snap } = await rig(server(4).get);
  controller.openSession({ id: 'busy', title: 'Busy' });
  await flush();
  gateway.event('message.start', 'rt-busy');
  await flush();
  for (let i = 0; i < SESSION_STATE_LRU + 3; i += 1) {
    controller.openSession({ id: `s${i}`, title: `S${i}` });
    await flush();
  }
  assert.ok(snap().entries.busy, 'its stream keeps landing in its own transcript');
  assert.equal(snap().entries.busy.transcript.running, true);
  controller.dispose();
});
