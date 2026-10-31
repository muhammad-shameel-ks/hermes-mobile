import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Message } from '../src/chat/transcript.ts';
import { migrate } from '../src/store/db.ts';
import { DraftStore, FRESH_DRAFT_KEY } from '../src/store/drafts.ts';
import { persistenceOver, wipeConnection } from '../src/store/index.ts';
import { DRAFT_ENTRIES, WARM_TAIL_ENTRIES, WARM_TAIL_MESSAGES } from '../src/store/lru.ts';
import { QueueStore } from '../src/store/queue.ts';
import { parseTail, persistable, serializeTail, TailStore } from '../src/store/sessions.ts';
import { memoryDb } from './support/sqlite.ts';

const message = (id: string, text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role: 'assistant',
  parts: [{ kind: 'text', text }],
  status: 'complete',
  ...extra,
});
const many = (count: number) => Array.from({ length: count }, (_, i) => message(`row-${i + 1}`, `m${i + 1}`));
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('migrating twice leaves the schema at the latest version', async () => {
  const db = await memoryDb();
  await migrate(db);
  const [row] = await db.all<{ user_version: number }>('PRAGMA user_version');
  assert.equal(row.user_version, 1);
});

test('a tail keeps the newest 40 messages and reads back as saved', async () => {
  const db = await memoryDb();
  const tails = new TailStore(async () => db, 'c1');
  await tails.save('default', 's1', many(60));
  const loaded = await tails.load('default', 's1');
  assert.equal(loaded?.length, WARM_TAIL_MESSAGES);
  assert.equal(loaded?.[0].id, 'row-21');
  assert.equal(loaded?.at(-1)?.id, 'row-60');
});

test('a tail is scoped to its connection and profile', async () => {
  const db = await memoryDb();
  await new TailStore(async () => db, 'c1').save('default', 's1', many(3));
  assert.equal(await new TailStore(async () => db, 'c2').load('default', 's1'), null);
  assert.equal(await new TailStore(async () => db, 'c1').load('ally', 's1'), null);
  assert.equal((await new TailStore(async () => db, 'c1').load('default', 's1'))?.length, 3);
});

test('half-streamed replies and live notices are not kept', () => {
  const kept = persistable([message('row-1', 'a'), message('live-x', 'streaming', { status: 'streaming' }), message('live-y', 'notice', { role: 'system' }), message('row-2', 'b')]);
  assert.deepEqual(kept.map((m) => m.id), ['row-1', 'row-2']);
  assert.equal(serializeTail([message('live-x', 'streaming', { status: 'streaming' })]), null);
});

test('a restored tail does not carry the reader’s send cue', () => {
  const restored = parseTail(serializeTail([message('live-u', 'hi', { role: 'user', sent: true }), message('row-2', 'b')]) as string);
  assert.deepEqual(restored?.map((m) => [m.id, m.sent]), [['live-u', undefined], ['row-2', undefined]]);
});

test('a heavy tail falls back to the last 8 messages, and an impossible one is not kept', () => {
  const heavy = (id: string, size: number) => message(id, 'x'.repeat(size));
  const fallback = serializeTail([...Array.from({ length: 32 }, (_, i) => heavy(`l${i}`, 5_000)), ...Array.from({ length: 8 }, (_, i) => heavy(`h${i}`, 20_000))]);
  assert.equal(parseTail(fallback as string)?.length, 8);
  assert.equal(serializeTail([heavy('big', 300_000)]), null);
});

test('saving an unkeepable transcript drops the stale tail instead of leaving it to paint', async () => {
  const db = await memoryDb();
  const tails = new TailStore(async () => db, 'c1');
  await tails.save('default', 's1', many(3));
  await tails.save('default', 's1', [message('big', 'x'.repeat(300_000))]);
  assert.equal(await tails.load('default', 's1'), null);
});

test('only the 50 most recently saved sessions keep a tail', async () => {
  const db = await memoryDb();
  let clock = 0;
  const tails = new TailStore(async () => db, 'c1', 0, () => (clock += 1));
  for (let i = 0; i < WARM_TAIL_ENTRIES + 3; i += 1) await tails.save('default', `s${i}`, many(2));
  assert.equal(await tails.load('default', 's0'), null);
  assert.equal(await tails.load('default', 's2'), null);
  assert.notEqual(await tails.load('default', 's3'), null);
  assert.notEqual(await tails.load('default', `s${WARM_TAIL_ENTRIES + 2}`), null);
});

test('a corrupt tail reads as a miss and evicts itself', async () => {
  const db = await memoryDb();
  await db.run('INSERT INTO tail (conn, profile, session, saved_at, payload) VALUES (?, ?, ?, ?, ?)', ['c1', 'default', 's1', 1, '{not json']);
  const tails = new TailStore(async () => db, 'c1');
  assert.equal(await tails.load('default', 's1'), null);
  assert.deepEqual(await db.all('SELECT * FROM tail'), []);
});

test('scheduled tails coalesce to the latest and write on flush', async () => {
  const db = await memoryDb();
  const tails = new TailStore(async () => db, 'c1', 10_000);
  tails.schedule('default', 's1', many(2));
  tails.schedule('default', 's1', many(5));
  assert.equal(await tails.load('default', 's1'), null);
  await tails.flush();
  assert.equal((await tails.load('default', 's1'))?.length, 5);
});

test('a scheduled tail writes itself after the quiet period', async () => {
  const db = await memoryDb();
  const tails = new TailStore(async () => db, 'c1', 1);
  tails.schedule('default', 's1', many(2));
  await tick();
  assert.equal((await tails.load('default', 's1'))?.length, 2);
});

test('storage trouble never throws out of the stores', async () => {
  const broken = async () => {
    throw new Error('no database');
  };
  const tails = new TailStore(broken, 'c1');
  assert.equal(await tails.load('default', 's1'), null);
  await tails.save('default', 's1', many(2));
  await tails.drop('default', 's1');
  const drafts = new DraftStore(broken, 'c1', 0);
  await drafts.hydrate();
  drafts.set('default', 's1', 'hello');
  await drafts.flush();
  assert.equal(drafts.get('default', 's1'), 'hello');
});

test('a draft survives a restart and clears when sent', async () => {
  const db = await memoryDb();
  const first = new DraftStore(async () => db, 'c1', 10_000);
  first.set('default', 's1', 'half a thought');
  first.set('default', FRESH_DRAFT_KEY, 'new chat text');
  await first.flush();

  const second = new DraftStore(async () => db, 'c1');
  assert.equal(second.get('default', 's1'), '');
  await second.hydrate();
  assert.equal(second.get('default', 's1'), 'half a thought');
  assert.equal(second.get('default', FRESH_DRAFT_KEY), 'new chat text');

  second.clear('default', 's1');
  await second.flush();
  const third = new DraftStore(async () => db, 'c1');
  await third.hydrate();
  assert.equal(third.get('default', 's1'), '');
  assert.equal(third.get('default', FRESH_DRAFT_KEY), 'new chat text');
});

test('typing before hydration wins over the saved copy', async () => {
  const db = await memoryDb();
  const saved = new DraftStore(async () => db, 'c1', 10_000);
  saved.set('default', 's1', 'old');
  await saved.flush();
  const next = new DraftStore(async () => db, 'c1');
  next.set('default', 's1', 'typed already');
  await next.hydrate();
  assert.equal(next.get('default', 's1'), 'typed already');
});

test('drafts are written after the debounce and only the changed ones', async () => {
  const db = await memoryDb();
  const drafts = new DraftStore(async () => db, 'c1', 1);
  drafts.set('default', 's1', 'a');
  drafts.set('default', 's1', 'ab');
  assert.deepEqual(await db.all('SELECT text FROM draft'), []);
  await tick();
  assert.deepEqual(await db.all('SELECT text FROM draft'), [{ text: 'ab' }]);
});

test('only the 50 newest drafts are kept', async () => {
  const db = await memoryDb();
  const drafts = new DraftStore(async () => db, 'c1', 10_000);
  for (let i = 0; i < DRAFT_ENTRIES + 4; i += 1) drafts.set('default', `s${i}`, `draft ${i}`);
  assert.equal(drafts.get('default', 's0'), '');
  assert.equal(drafts.get('default', 's4'), 'draft 4');
  await drafts.flush();
  const rows = await db.all<{ session: string }>('SELECT session FROM draft');
  assert.equal(rows.length, DRAFT_ENTRIES);
  assert.ok(!rows.some((row) => row.session === 's3'));
});

test('a whitespace-only draft is typeable but is not stored', async () => {
  const db = await memoryDb();
  const drafts = new DraftStore(async () => db, 'c1', 10_000);
  drafts.set('default', 's1', '  ');
  assert.equal(drafts.get('default', 's1'), '  ');
  await drafts.flush();
  assert.deepEqual(await db.all('SELECT * FROM draft'), []);
  drafts.release('default', 's1');
  assert.equal(drafts.get('default', 's1'), '');
});

test('subscribers hear every change', () => {
  const drafts = new DraftStore(null, '');
  let heard = 0;
  const off = drafts.subscribe(() => (heard += 1));
  drafts.set('default', 's1', 'a');
  drafts.set('default', 's1', 'a');
  drafts.clear('default', 's1');
  off();
  drafts.set('default', 's1', 'b');
  assert.equal(heard, 2);
});

test('a gone session hands its draft to the fresh chat with an undoable notice', () => {
  const drafts = new DraftStore(null, '');
  drafts.set('default', 'dead', 'unsent');
  assert.equal(drafts.adoptGone('default', 'dead'), true);
  assert.equal(drafts.get('default', FRESH_DRAFT_KEY), 'unsent');
  assert.equal(drafts.get('default', 'dead'), '');
  assert.deepEqual(drafts.getRestored(), { profile: 'default', fromKey: 'dead', text: 'unsent' });

  assert.equal(drafts.undoRestored('unsent'), true);
  assert.equal(drafts.get('default', FRESH_DRAFT_KEY), '');
  assert.equal(drafts.get('default', 'dead'), 'unsent');
  assert.equal(drafts.getRestored(), null);
});

test('undo after editing only dismisses, and a gone draft never overwrites a new chat in progress', () => {
  const drafts = new DraftStore(null, '');
  drafts.set('default', 'dead', 'unsent');
  drafts.adoptGone('default', 'dead');
  assert.equal(drafts.undoRestored('unsent plus more'), false);
  assert.equal(drafts.getRestored(), null);
  assert.equal(drafts.get('default', FRESH_DRAFT_KEY), 'unsent');

  const busy = new DraftStore(null, '');
  busy.set('default', FRESH_DRAFT_KEY, 'composing');
  busy.set('default', 'dead', 'unsent');
  assert.equal(busy.adoptGone('default', 'dead'), false);
  assert.equal(busy.get('default', 'dead'), 'unsent');
  assert.equal(busy.getRestored(), null);
});

test('emptying the restored draft retires its notice', () => {
  const drafts = new DraftStore(null, '');
  drafts.set('default', 'dead', 'unsent');
  drafts.adoptGone('default', 'dead');
  drafts.clear('default', FRESH_DRAFT_KEY);
  assert.equal(drafts.getRestored(), null);
});

test('a queue is kept per session as opaque items', async () => {
  const db = await memoryDb();
  const queue = new QueueStore(async () => db, 'c1');
  assert.deepEqual(await queue.load('default', 's1'), []);
  await queue.save('default', 's1', [{ text: 'one' }, { text: 'two' }]);
  await queue.save('default', 's2', [{ text: 'other' }]);
  assert.deepEqual(await queue.load('default', 's1'), [{ text: 'one' }, { text: 'two' }]);
  assert.equal((await queue.all()).length, 2);
  await queue.save('default', 's1', []);
  assert.deepEqual(await queue.load('default', 's1'), []);
  assert.equal((await queue.all()).length, 1);
});

test('wiping a connection removes its tails, drafts and queues and nothing of another', async () => {
  const db = await memoryDb();
  const mine = persistenceOver(async () => db, 'c1');
  const other = persistenceOver(async () => db, 'c2');
  for (const store of [mine, other]) {
    await store.tails.save('default', 's1', many(2));
    store.drafts.set('default', 's1', 'text');
    await store.queue.save('default', 's1', [{ text: 'q' }]);
    await store.flush();
  }
  await wipeConnection('c1', async () => db);
  assert.equal(await mine.tails.load('default', 's1'), null);
  assert.deepEqual(await mine.queue.load('default', 's1'), []);
  assert.equal((await db.all('SELECT * FROM draft WHERE conn = ?', ['c1'])).length, 0);
  assert.notEqual(await other.tails.load('default', 's1'), null);
  assert.equal((await db.all('SELECT * FROM draft WHERE conn = ?', ['c2'])).length, 1);
});
