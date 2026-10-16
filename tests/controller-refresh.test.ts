import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HISTORY_LIMIT } from '../src/chat/history.ts';
import type { SessionMessage } from '../src/chat/transcript.ts';
import { flush, rig } from './support/gateway.ts';
import { memoryDb } from './support/sqlite.ts';
import { persistenceOver } from '../src/store/index.ts';

const buildRows = (from: number, to: number): SessionMessage[] => {
  const out: SessionMessage[] = [];
  for (let id = from; id <= to; id += 1) out.push({ id, role: id % 2 === 1 ? 'user' : 'assistant', content: `m${id}` });
  return out;
};

/** a server holding `total` rows, answering the way /messages does: offsets count back from the newest row */
function server(total: number) {
  const get = (_path: string, query: Record<string, unknown>) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset ?? 0);
    const to = total - offset;
    return { messages: buildRows(Math.max(1, to - limit + 1), to), pagination: { limit, offset, order: 'latest' } };
  };
  return { get };
}

const messageText = (m: { parts: Array<{ kind: string; text?: string }> }) => m.parts.map((p) => p.text ?? '').join('');

test('refreshOpen re-reads the newest page and keeps older pages the reader pulled in', async () => {
  const { controller, snap } = await rig(server(250).get);
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  await controller.showEarlier('s1');
  assert.equal(snap().entries.s1.transcript.messages.length, 240);

  await controller.refreshOpen('s1');
  assert.equal(snap().entries.s1.loading, false);
  assert.deepEqual(
    snap().entries.s1.transcript.messages.map(messageText).slice(-3),
    ['m248', 'm249', 'm250'],
  );
  assert.ok(snap().entries.s1.transcript.messages.length >= 240, 'older pages survive the refresh');
  controller.dispose();
});

test('refreshOpen is a no-op for the draft, a load in flight, or a running turn', async () => {
  const { controller, gateway, snap } = await rig(server(6).get);
  await controller.refreshOpen();
  assert.equal(snap().entries.draft.transcript.messages.length, 0);

  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  gateway.event('message.start', 'rt-s1');
  await flush();
  assert.equal(snap().entries.s1.transcript.running, true);
  const before = snap().entries.s1.transcript.messages.length;
  await controller.refreshOpen('s1');
  assert.equal(snap().entries.s1.transcript.messages.length, before, 'a running turn is never reloaded from under the stream');
  controller.dispose();
});

test('refreshOpen reloads a session whose history failed to load', async () => {
  const db = await memoryDb();
  const persistence = persistenceOver(async () => db, 'c1');
  let fail = true;
  const { controller, snap } = await rig(
    () => {
      if (fail) throw new Error('network down');
      return { messages: buildRows(1, 2), pagination: { limit: HISTORY_LIMIT, offset: 0, order: 'latest' } };
    },
    persistence,
  );
  controller.openSession({ id: 's1', title: 'One' });
  await flush();
  assert.match(snap().entries.s1.error ?? '', /network down/);

  fail = false;
  await controller.refreshOpen('s1');
  assert.equal(snap().entries.s1.error, null);
  assert.deepEqual(snap().entries.s1.transcript.messages.map(messageText), ['m1', 'm2']);
  controller.dispose();
});
