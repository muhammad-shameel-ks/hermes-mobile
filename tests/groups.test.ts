import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Room, RoomEvent } from '../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { JSON_RPC_METHOD_NOT_FOUND, JsonRpcGatewayError } from '../vendor/hermes-shared/src/json-rpc-channel.ts';
import { createGroupsApi, TAIL_EVENTS, type GroupsRpc } from '../src/groups/api.ts';
import { GroupsModel } from '../src/groups/model.ts';
import { RoomStore, type RoomClock, type Unsent } from '../src/groups/roomStore.ts';
import {
  buildTimeline,
  completeMention,
  mentionAtEnd,
  mentionOptions,
  memberInput,
  mergeEvents,
  newGroupProblem,
  pendingActions,
  roomPreview,
  splitMentions,
  toGroupRoom,
  type GroupMember,
} from '../src/groups/rooms.ts';

const members: GroupMember[] = [
  { memberId: 'ada', profile: 'ada', handle: 'ada', label: 'Ada' },
  { memberId: 'bo', profile: 'bo', handle: 'bo', label: 'Bo' },
];

let nextSeq = 1;
const event = (kind: string, payload: Record<string, unknown> = {}, actor: RoomEvent['actor'] & { display_name?: string } = { kind: 'gateway', id: 'gw' }, seq = nextSeq++): RoomEvent => ({
  room_id: 'r1',
  seq,
  event_id: `e${seq}`,
  kind,
  actor,
  payload,
  created_at: 1000 + seq,
});
const user = (text: string, seq?: number) => event('message.user', { text, thread_id: 't' }, { kind: 'user', id: 'me' }, seq);
const said = (member: string, text: string, seq?: number) => event('message.member', { text, member_id: member }, { kind: 'member', id: member }, seq);

const room = (patch: Partial<Room> = {}): Room => ({
  room_id: 'r1',
  name: 'Team',
  members: [
    { member_id: 'ada', profile: 'ada', handle: 'ada', display_name: 'Ada L' },
    { member_id: 'bo', profile: 'bo', handle: 'bo' },
  ],
  authority_gateway_id: 'gw',
  authority_epoch: 1,
  revision: 1,
  created_at: 10,
  updated_at: 20,
  ...patch,
});

// ─── the log as a transcript ────────────────────────────────────────────────

test('the timeline keeps messages and the notes that explain silence, and drops turn bookkeeping', () => {
  const rows = buildTimeline(
    [
      user('hello @ada', 1),
      event('turn.settled', { passed: true }, undefined, 2),
      said('ada', 'hi there', 3),
      event('turn.failed', { member_id: 'bo', error: 'quota exceeded' }, undefined, 4),
      event('room.stop_requested', { cancel_id: 'c' }, undefined, 5),
      event('authority.claimed', {}, { kind: 'system', id: 'gw' }, 6),
    ],
    members,
  );
  assert.deepEqual(
    rows.map((row) => [row.kind, row.kind === 'note' ? row.text : row.kind === 'member' ? `${row.speaker}: ${row.text}` : row.text]),
    [
      ['user', 'hello @ada'],
      ['member', 'Ada: hi there'],
      ['note', 'Bo could not reply: quota exceeded'],
      ['note', 'Stopped. The bots on turn were interrupted.'],
    ],
  );
});

test('a member who left the roster is still named from the event itself', () => {
  const [row] = buildTimeline([event('message.member', { text: 'still here', member_id: 'gone' }, { kind: 'member', id: 'gone', display_name: 'Gone Bot' })], members);
  assert.equal(row.kind === 'member' && row.speaker, 'Gone Bot');
  assert.equal(row.kind === 'member' && row.member, null);
});

test('the preview is the newest message, led by who said it', () => {
  const log = [said('ada', 'older', 1), user('newest from me', 2), event('turn.settled', { passed: true }, undefined, 3)];
  assert.equal(roomPreview(log, members), 'You: newest from me');
  assert.equal(roomPreview([user('a', 1), said('bo', '**bold** reply', 2)], members), 'Bo: bold reply');
  assert.equal(roomPreview([event('turn.settled', {}, undefined, 1)], members), '');
});

test('merging a page keeps the log ordered and unique, and hands back the same array when nothing is new', () => {
  const base = [user('a', 1), user('b', 2)];
  assert.equal(mergeEvents(base, [user('b', 2)]), base);
  assert.equal(mergeEvents(base, []), base);
  assert.deepEqual(
    mergeEvents(base, [user('older', 0), user('c', 3)]).map((e) => e.seq),
    [0, 1, 2, 3],
  );
});

// ─── mentions ───────────────────────────────────────────────────────────────

test('a mention being typed completes to its handle and keeps the words before it', () => {
  assert.deepEqual(mentionAtEnd('what do you think @a'), { query: 'a', start: 18 });
  assert.equal(mentionAtEnd('mail me at a@b'), null);
  assert.equal(mentionAtEnd('done @ada '), null);
  assert.equal(completeMention('what do you think @a', 'ada'), 'what do you think @ada ');
  assert.deepEqual(
    mentionOptions(members, 'b').map((o) => o.handle),
    ['bo'],
  );
  assert.equal(mentionOptions(members, '')[0].handle, 'everyone');
});

test('only handles that address a member or the room read as mentions', () => {
  assert.deepEqual(splitMentions('@ada and @nobody, plus @everyone', members), [
    { text: '@ada', mention: true },
    { text: ' and @nobody, plus ', mention: false },
    { text: '@everyone', mention: true },
  ]);
});

// ─── what the driver waits on ───────────────────────────────────────────────

test('a pending approval needs its full identity and a retry needs only its task', () => {
  const actions = pendingActions({
    running: true,
    working: true,
    blocked: true,
    counts: {},
    peer_routes: [],
    pending_actions: [
      { kind: 'approval', member_id: 'ada', task_id: 't1', execution_generation: 2, request_id: 'req', approval: { command: 'rm -rf build', description: 'delete' } },
      { kind: 'approval', member_id: 'ada', task_id: 't2', execution_generation: 0, request_id: 'req' },
      { kind: 'approval', member_id: 'ada', task_id: 't3', execution_generation: 1 },
      { kind: 'retry', task_id: 't4' },
      { kind: 'retry' },
    ],
  });
  assert.deepEqual(
    actions.map((a) => a.key),
    ['approval:t1:2:req', 'retry:t4'],
  );
  assert.equal(actions[0].kind === 'approval' && actions[0].command, 'rm -rf build');
});

// ─── creating ───────────────────────────────────────────────────────────────

test('a group needs two to six bots with distinct mentions', () => {
  const bot = (name: string) => ({ name, label: name });
  assert.match(newGroupProblem([bot('a')]) ?? '', /at least 2/);
  assert.match(newGroupProblem(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(bot)) ?? '', /at most 6/);
  assert.equal(newGroupProblem([bot('a'), bot('b')]), null);
  // the default profile answers to @hermes, so a profile of that name would collide with it
  assert.match(newGroupProblem([bot('default'), bot('hermes')]) ?? '', /@hermes/);
  assert.match(newGroupProblem([bot('all'), bot('b')]) ?? '', /@all/);
  assert.match(newGroupProblem([bot('-odd'), bot('b')]) ?? '', /cannot be mentioned/);
});

test('a member goes to the gateway as a local profile with its mention handle', () => {
  assert.deepEqual(memberInput({ name: 'default', label: 'Hermes' }), {
    member_id: 'default',
    profile: 'default',
    handle: 'hermes',
    target: { kind: 'local', profile: 'default' },
    display_name: 'Hermes',
  });
});

test('the roster name for a profile wins over the one the room stored', () => {
  const stored = toGroupRoom(room());
  assert.deepEqual(
    stored.members.map((m) => m.label),
    ['Ada L', 'Bo'],
  );
  const live = toGroupRoom(room(), (profile) => (profile === 'ada' ? 'Ada Lovelace' : undefined));
  assert.equal(live.members[0].label, 'Ada Lovelace');
});

// ─── the api over a scripted gateway ────────────────────────────────────────

type Call = { method: string; params: Record<string, unknown> };

function gateway(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const rpc = (async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    const handler = handlers[method];
    if (!handler) throw new JsonRpcGatewayError('method not found', { code: JSON_RPC_METHOD_NOT_FOUND });
    return handler(params);
  }) as unknown as GroupsRpc;
  return { rpc, calls };
}

const logPage = (all: RoomEvent[]) => (params: Record<string, unknown>) => {
  const since = params.since_seq as number;
  const limit = params.limit as number;
  const events = all.filter((e) => e.seq > since).slice(0, limit);
  const cursor = events.length ? events[events.length - 1].seq : since;
  const latest = all.length ? all[all.length - 1].seq : 0;
  return { events, cursor, latest_seq: latest, has_more: cursor < latest, authority: { gateway_id: 'gw', epoch: 1 } };
};

const sequence = (n: number) => Array.from({ length: n }, (_, i) => user(`m${i + 1}`, i + 1));

test('the room opens on its newest window and pulls older history in by seq', async () => {
  const all = sequence(450);
  const { rpc, calls } = gateway({ 'groups.log': logPage(all) });
  const api = createGroupsApi(rpc, () => 'default', () => 'id');
  const tail = await api.tail('r1', 450);
  assert.equal(tail.events[0].seq, 450 - TAIL_EVENTS + 1);
  assert.equal(tail.events.at(-1)?.seq, 450);
  assert.ok(calls.every((c) => c.params.profile === 'default' && c.params.room_id === 'r1'));

  const earlier = await api.earlier('r1', tail.events[0].seq);
  assert.equal(earlier.events.at(-1)?.seq, tail.events[0].seq - 1);
  assert.equal(earlier.events.length, TAIL_EVENTS);
});

test('a log that stops advancing is an error rather than a loop', async () => {
  const stuck = () => ({ events: [], cursor: 0, latest_seq: 5, has_more: true, authority: { gateway_id: 'gw', epoch: 1 } });
  const api = createGroupsApi(gateway({ 'groups.log': stuck }).rpc, () => 'default', () => 'id');
  await assert.rejects(api.after('r1', 0), /did not advance/);
});

test('sending appends one inert message under the caller\'s event id', async () => {
  const { rpc, calls } = gateway({ 'groups.send': () => ({ event: {}, accepted: true }) });
  const api = createGroupsApi(rpc, () => 'default', () => 'id');
  await api.send('r1', 'evt-1', 'hello');
  assert.deepEqual(calls[0].params, { profile: 'default', room_id: 'r1', event_id: 'evt-1', payload: { text: 'hello', thread_id: 'evt-1' } });
});

test('creating mints the room id once and refuses a roster the gateway would refuse', async () => {
  const { rpc, calls } = gateway({ 'groups.create': (p) => ({ room: room({ room_id: p.room_id as string, name: p.name as string }) }) });
  const api = createGroupsApi(rpc, () => 'default', () => 'minted');
  const created = await api.create('  Team  ', [{ name: 'ada', label: 'Ada' }, { name: 'bo', label: 'Bo' }]);
  assert.equal(created.room_id, 'minted');
  assert.equal(calls[0].params.name, 'Team');
  assert.equal((calls[0].params.members as unknown[]).length, 2);
  await assert.rejects(api.create('Solo', [{ name: 'ada', label: 'Ada' }]), /at least 2/);
  assert.equal(calls.length, 1);
});

// ─── one open room ──────────────────────────────────────────────────────────

function harness(options: { events?: RoomEvent[]; driver?: Record<string, unknown> | null; online?: () => boolean; journal?: Map<string, Unsent> } = {}) {
  const log = options.events ?? [user('first', 1), said('ada', 'second', 2)];
  const state = { room: room({ latest_seq: log.length }), driver: options.driver === undefined ? { running: true, working: false, blocked: false, counts: {}, pending_actions: [], peer_routes: [] } : options.driver };
  const fake = gateway({
    'groups.state': () => ({ room: { ...state.room, latest_seq: log.length }, ...(state.driver ? { driver_status: state.driver } : {}) }),
    'groups.log': (p) => logPage(log)(p),
    'groups.send': () => ({ event: {}, accepted: true }),
    'groups.stop': () => ({ cancelled: 1 }),
  });
  const timers: Array<{ ms: number; run: () => void }> = [];
  const after: RoomClock = (ms, run) => {
    const entry = { ms, run };
    timers.push(entry);
    return () => timers.splice(timers.indexOf(entry), 1);
  };
  const journal = options.journal ?? new Map<string, Unsent>();
  let ids = 0;
  const store = new RoomStore(createGroupsApi(fake.rpc, () => 'default', () => `id${++ids}`), 'r1', { online: options.online ?? (() => true), newId: () => `evt${++ids}`, journal, after });
  return { store, log, state, fake, timers, journal };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

test('a room opens on its log, then each poll reads only what came after', async () => {
  const h = harness();
  h.store.start();
  await settle();
  assert.equal(h.store.getSnapshot().phase, 'ready');
  assert.deepEqual(h.store.getSnapshot().events.map((e) => e.seq), [1, 2]);
  assert.equal(h.store.getSnapshot().more, false);

  h.log.push(said('bo', 'third', 3));
  h.fake.calls.length = 0;
  h.timers.shift()?.run();
  await settle();
  assert.deepEqual(h.store.getSnapshot().events.map((e) => e.seq), [1, 2, 3]);
  const reads = h.fake.calls.filter((c) => c.method === 'groups.log');
  assert.deepEqual(reads.map((c) => c.params.since_seq), [2]);
  h.store.stop();
});

test('polling quickens while the driver works and does not run while the socket is down', async () => {
  const quiet = harness();
  quiet.store.start();
  await settle();
  const quietWait = quiet.timers[0].ms;
  quiet.store.stop();

  const busy = harness({ driver: { running: true, working: true, blocked: false, counts: {}, pending_actions: [], peer_routes: [] } });
  busy.store.start();
  await settle();
  assert.ok(busy.timers[0].ms < quietWait);
  busy.store.stop();

  const offline = harness({ online: () => false });
  offline.store.start();
  await settle();
  assert.equal(offline.fake.calls.length, 0);
  assert.equal(offline.store.getSnapshot().phase, 'loading');
  offline.store.stop();
});

test('a room disbanded elsewhere ends the screen instead of polling forever', async () => {
  const h = harness();
  h.store.start();
  await settle();
  h.fake.calls.length = 0;
  h.state.room.disbanded_at = 99;
  h.timers.shift()?.run();
  await settle();
  assert.equal(h.store.getSnapshot().phase, 'gone');
  assert.equal(h.timers.length, 0);
  h.store.stop();
});

test('a room with no driver can be read and says so', async () => {
  const h = harness({ driver: null });
  h.store.start();
  await settle();
  assert.equal(h.store.getSnapshot().phase, 'ready');
  assert.equal(h.store.getSnapshot().driver, null);
  h.store.stop();
});

test('a refused send leaves the text with the reader; a silent one is held and retried under the same event id', async () => {
  const h = harness();
  h.store.start();
  await settle();

  const sends: Array<Record<string, unknown>> = [];
  let mode: 'refuse' | 'drop' | 'ok' = 'refuse';
  h.fake.calls.length = 0;
  const original = h.fake.rpc;
  const rpc = (async (method: string, params: Record<string, unknown>) => {
    if (method === 'groups.send') {
      sends.push(params);
      if (mode === 'refuse') throw new JsonRpcGatewayError('payload invalid', { code: 4111 });
      if (mode === 'drop') throw new Error('request timed out after 30s: groups.send');
    }
    return (original as unknown as (m: string, p: Record<string, unknown>) => unknown)(method, params);
  }) as unknown as GroupsRpc;
  const store = new RoomStore(createGroupsApi(rpc, () => 'default', () => 'x'), 'r1', {
    online: () => true,
    newId: (() => {
      let n = 0;
      return () => `evt${++n}`;
    })(),
    journal: h.journal,
    after: () => () => undefined,
  });
  store.start();
  await settle();

  assert.equal(await store.send('hello'), 'rejected');
  assert.equal(store.getSnapshot().unsent, null);
  assert.match(store.getSnapshot().actionError ?? '', /payload invalid/);

  mode = 'drop';
  assert.equal(await store.send('hello'), 'unconfirmed');
  assert.deepEqual(store.getSnapshot().unsent, { eventId: 'evt2', text: 'hello' });
  assert.deepEqual(h.journal.get('r1'), { eventId: 'evt2', text: 'hello' });

  // another message waits behind the unconfirmed one
  assert.equal(await store.send('something else'), 'blocked');

  mode = 'ok';
  assert.equal(await store.retryUnsent(), 'sent');
  assert.deepEqual(sends.slice(1).map((p) => p.event_id), ['evt2', 'evt2']);
  assert.equal(store.getSnapshot().unsent, null);
  assert.equal(h.journal.has('r1'), false);
  assert.equal(await store.send('   '), 'empty');
  store.stop();
  h.store.stop();
});

test('an unconfirmed send survives closing the room', async () => {
  const journal = new Map<string, Unsent>([['r1', { eventId: 'evt9', text: 'pending' }]]);
  const h = harness({ journal });
  assert.deepEqual(h.store.getSnapshot().unsent, { eventId: 'evt9', text: 'pending' });
});

test('stop is one write, and the room is read again after it', async () => {
  const h = harness();
  h.store.start();
  await settle();
  h.fake.calls.length = 0;
  assert.equal(await h.store.stopRun(), true);
  await settle();
  assert.deepEqual(h.fake.calls.map((c) => c.method).filter((m) => m !== 'groups.log'), ['groups.stop', 'groups.state']);
  h.store.stop();
});

// ─── the roster of rooms ────────────────────────────────────────────────────

function modelOver(handlers: Record<string, (params: Record<string, unknown>) => unknown>, online = true) {
  const fake = gateway(handlers);
  const model = new GroupsModel({ api: createGroupsApi(fake.rpc, () => 'default', () => 'id'), online: () => online, labelOf: () => undefined, newId: () => 'id' });
  return { model, fake };
}

test('the roster lists live rooms and fills each preview from its newest messages', async () => {
  const log = [user('hi', 1), said('ada', 'welcome', 2)];
  const { model } = modelOver({
    'groups.capabilities': () => ({ driver: true }),
    'groups.list': () => ({ rooms: [room({ latest_seq: 2 }), room({ room_id: 'gone', disbanded_at: 5 })], next_offset: null }),
    'groups.log': logPage(log),
  });
  await model.refresh();
  await settle();
  const { rows, driver, loaded } = model.getSnapshot();
  assert.equal(loaded, true);
  assert.equal(driver, true);
  assert.deepEqual(rows.map((r) => [r.room.id, r.preview]), [['r1', 'Ada L: welcome']]);
});

test('a gateway without the group methods, or without a driver, lists nothing and is not an error', async () => {
  const none = modelOver({});
  await none.model.refresh();
  assert.deepEqual([none.model.getSnapshot().driver, none.model.getSnapshot().error, none.model.getSnapshot().rows], [false, null, []]);

  const idle = modelOver({ 'groups.capabilities': () => ({ driver: false }) });
  await idle.model.refresh();
  assert.equal(idle.model.getSnapshot().driver, false);
  assert.equal(idle.fake.calls.some((c) => c.method === 'groups.list'), false);
});

test('a failed refresh keeps the last good roster and reports the error', async () => {
  let fail = false;
  const { model } = modelOver({
    'groups.capabilities': () => ({ driver: true }),
    'groups.list': () => {
      if (fail) throw new Error('boom');
      return { rooms: [room({ latest_seq: 0 })], next_offset: null };
    },
    'groups.log': logPage([]),
  });
  await model.refresh();
  fail = true;
  await model.refresh();
  assert.equal(model.getSnapshot().rows.length, 1);
  assert.equal(model.getSnapshot().error, 'boom');
});

test('a created group heads the roster at once', async () => {
  const { model } = modelOver({ 'groups.create': (p) => ({ room: room({ room_id: p.room_id as string, name: p.name as string }) }) });
  const created = await model.create('Fresh', [{ name: 'ada', label: 'Ada' }, { name: 'bo', label: 'Bo' }]);
  assert.equal(model.getSnapshot().rows[0].room.id, created.id);
  assert.equal(model.getSnapshot().driver, true);
});
