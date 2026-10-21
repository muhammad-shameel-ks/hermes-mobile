import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, type GatewayApi } from '../src/gateway/api.ts';
import { LiveResource } from '../src/kanban/live.ts';
import { parsePrefs } from '../src/kanban/prefs.ts';
import { attachmentUrl, createKanbanRest, isPluginOff, type KanbanClock } from '../src/kanban/rest.ts';

function recorder() {
  const calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }> = [];
  const record = (method: string) => async (path: string, a?: unknown, b?: unknown) => {
    const read = method === 'GET' || method === 'DELETE';
    calls.push({ method, path, body: read ? undefined : a, query: read ? a : b });
    return { results: [], task: null };
  };
  const api = { get: record('GET'), post: record('POST'), patch: record('PATCH'), put: record('PUT'), del: record('DELETE') } as unknown as GatewayApi;
  return { api, calls };
}

/** a clock the test advances by hand */
function manualClock() {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const after: KanbanClock = (ms, run) => {
    const timer = { at: now + ms, run, live: true };
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers) {
      if (timer.live && timer.at <= now) {
        timer.live = false;
        timer.run();
      }
    }
  };
  return { after, advance, pending: () => timers.filter((t) => t.live).length };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the server-current board is never named, so the phone does not move its pointer; a selected one always is', async () => {
  const { api, calls } = recorder();
  let board = '';
  const rest = createKanbanRest(api, { profile: () => 'ada', board: () => board });
  await rest.board(false);
  board = 'ops';
  await rest.board(true);
  assert.deepEqual(calls[0], { method: 'GET', path: '/api/plugins/kanban/board', body: undefined, query: { include_archived: undefined, board: undefined, profile: 'ada' } });
  assert.deepEqual(calls[1].query, { include_archived: true, board: 'ops', profile: 'ada' });
});

test('writes nudge the dispatcher once, after the last of a burst; reads and comments do not', async () => {
  const { api, calls } = recorder();
  const clock = manualClock();
  const rest = createKanbanRest(api, { profile: () => 'ada', board: () => 'ops' }, clock.after);
  await rest.patchTask('t_1', { status: 'ready' });
  await rest.bulk(['t_1', 't_2'], { archive: true });
  await rest.comment('t_1', 'hi');
  await rest.task('t_1');
  clock.advance(399);
  assert.equal(calls.filter((c) => c.path.endsWith('/dispatch')).length, 0);
  clock.advance(1);
  const nudges = calls.filter((c) => c.path.endsWith('/dispatch'));
  assert.equal(nudges.length, 1);
  assert.deepEqual(nudges[0].query, { board: 'ops', profile: 'ada' });
  assert.deepEqual(calls[1].body, { ids: ['t_1', 't_2'], archive: true });
  assert.deepEqual(calls[2].body, { author: 'mobile', body: 'hi' });
});

test('a disposed client drops its pending nudge', async () => {
  const { api, calls } = recorder();
  const clock = manualClock();
  const rest = createKanbanRest(api, { profile: () => 'ada', board: () => '' }, clock.after);
  await rest.deleteTask('t_1');
  rest.dispose();
  clock.advance(1000);
  assert.equal(calls.filter((c) => c.path.endsWith('/dispatch')).length, 0);
});

test('a failed write does not nudge', async () => {
  const clock = manualClock();
  const failing = { patch: async () => Promise.reject(new Error('409')), post: async () => ({}) } as unknown as GatewayApi;
  const rest = createKanbanRest(failing, { profile: () => 'ada', board: () => '' }, clock.after);
  await assert.rejects(rest.patchTask('t_1', { status: 'running' }));
  assert.equal(clock.pending(), 0);
});

test('task ids and attachment ids are encoded into their paths', async () => {
  const { api, calls } = recorder();
  const rest = createKanbanRest(api, { profile: () => 'ada', board: () => '' });
  await rest.log('t/1');
  assert.equal(calls[0].path, '/api/plugins/kanban/tasks/t%2F1/log');
  assert.equal(attachmentUrl('https://h', 7, 'ops', 'ada'), 'https://h/api/plugins/kanban/attachments/7?board=ops&profile=ada');
  assert.equal(attachmentUrl('https://h', 7, '', 'ada'), 'https://h/api/plugins/kanban/attachments/7?profile=ada');
});

test('a switched-off plugin is told apart from a missing task', () => {
  assert.equal(isPluginOff(new ApiError('GET', '/x', 404, '{"detail":"Plugin not found"}')), true);
  assert.equal(isPluginOff(new ApiError('GET', '/x', 404, '{"detail":"task t_1 not found"}')), false);
  assert.equal(isPluginOff(new ApiError('GET', '/x', 404, 'Not Found')), false);
  assert.equal(isPluginOff(new ApiError('GET', '/x', 500, '{"detail":"Plugin not found"}')), false);
  assert.equal(isPluginOff(new Error('Plugin not found')), false);
});

test('a live read polls only while started, and keeps its data through a failed read', async () => {
  const clock = manualClock();
  let n = 0;
  let fail = false;
  const live = new LiveResource<number>({ load: async () => (fail ? Promise.reject(new Error('down')) : ++n), intervalMs: () => 1000, after: clock.after });
  live.start();
  await settle();
  assert.equal(live.getSnapshot().data, 1);
  clock.advance(1000);
  await settle();
  assert.equal(live.getSnapshot().data, 2);
  fail = true;
  clock.advance(1000);
  await settle();
  assert.equal(live.getSnapshot().data, 2);
  assert.match(String(live.getSnapshot().error), /down/);
  live.stop();
  fail = false;
  clock.advance(5000);
  await settle();
  assert.equal(live.getSnapshot().data, 2);
  assert.equal(clock.pending(), 0);
});

test('a read that left before an optimistic write is dropped and read again, so the old state never repaints', async () => {
  const clock = manualClock();
  const answers: Array<(value: string) => void> = [];
  const live = new LiveResource<string>({ load: () => new Promise((resolve) => answers.push(resolve)), intervalMs: () => 1000, after: clock.after });
  live.start();
  answers.shift()!('server-v1');
  await settle();
  assert.equal(live.getSnapshot().data, 'server-v1');

  void live.refresh();
  const previous = live.update(() => 'optimistic');
  assert.equal(previous, 'server-v1');
  answers.shift()!('stale');
  await settle();
  assert.equal(live.getSnapshot().data, 'optimistic');
  answers.shift()!('server-v2');
  await settle();
  assert.equal(live.getSnapshot().data, 'server-v2');
});

test('a rolled-back edit restores what it replaced; nothing paints before the first read', async () => {
  const live = new LiveResource<string>({ load: async () => 'v1', intervalMs: () => 1000, after: manualClock().after });
  assert.equal(live.update(() => 'x'), null);
  assert.equal(live.getSnapshot().data, null);
  await live.refresh();
  const previous = live.update(() => 'x');
  live.restore(previous);
  assert.equal(live.getSnapshot().data, 'v1');
});

test('stored preferences tolerate damage and keep only well-typed boards', () => {
  assert.deepEqual(parsePrefs(null), { introDismissed: false, groupRunning: false, boards: {} });
  assert.deepEqual(parsePrefs('{nope'), { introDismissed: false, groupRunning: false, boards: {} });
  assert.deepEqual(parsePrefs('{"introDismissed":true,"groupRunning":"yes","boards":{"https://a":"ops","https://b":3}}'), {
    introDismissed: true,
    groupRunning: false,
    boards: { 'https://a': 'ops' },
  });
});
