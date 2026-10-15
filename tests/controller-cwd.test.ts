import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { ChatController } from '../src/chat/controller.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';
import { resetTurnBases, turnBaseFor } from '../src/review/tree.ts';
import { startedTurnCwds } from '../src/review/turn-base.ts';
import { FakeGateway, flush } from './support/gateway.ts';

beforeEach(() => resetTurnBases());

async function setup(cwd: string | undefined, head: string | null = 'a'.repeat(40)) {
  const gateway = new FakeGateway();
  const revParses: Array<Record<string, unknown>> = [];
  const info = cwd ? { cwd } : {};
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info });
  gateway.handlers['session.resume'] = (p) => ({ session_id: `rt-${p.session_id}`, message_count: 0, messages: [], info });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  const api: GatewayApi = {
    get: async <T>(path: string, query: Record<string, unknown> = {}) => {
      if (path === '/api/git/review/rev-parse') {
        revParses.push(query);
        return { sha: head } as T;
      }
      return (/\/messages/.test(path) ? { messages: [] } : { sessions: [] }) as T;
    },
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    put: async <T>() => ({}) as T,
    del: async <T>() => ({}) as T,
  };
  const link = new GatewayLink({
    mintUrl: async () => 'wss://gw/api/ws?ticket=t',
    onAuthRejected: () => undefined,
    socketFactory: () => gateway as unknown as WebSocket,
  });
  const controller = new ChatController(link, api);
  controller.start();
  await flush();
  gateway.open();
  await flush();
  return { gateway, controller, revParses, snap: () => controller.getSnapshot() };
}

test('a session created from the draft keeps its working directory and records HEAD when the first turn starts', async () => {
  const { gateway, controller, revParses, snap } = await setup('/work/repo');
  await controller.send('hello');
  await flush();
  assert.equal(snap().entries.s1.cwd, '/work/repo');
  assert.equal(controller.openCwd(), '/work/repo');
  assert.deepEqual(revParses, [{ path: '/work/repo', ref: 'HEAD' }]);
  assert.equal(turnBaseFor('/work/repo'), 'a'.repeat(40));
  gateway.close();
  controller.dispose();
});

test('a resumed session reports its cwd, and each new turn captures the baseline once', async () => {
  const { gateway, controller, revParses, snap } = await setup('/work/repo');
  controller.openSession({ id: 's9', title: 'old' });
  await flush();
  assert.equal(snap().entries.s9.cwd, '/work/repo');
  assert.equal(revParses.length, 0, 'an idle session captures nothing');

  gateway.event('message.start', 'rt-s9');
  await flush();
  gateway.event('tool.start', 'rt-s9', { name: 'terminal', tool_id: 't1' });
  await flush();
  assert.equal(revParses.length, 1, 'events inside the same turn do not capture again');

  gateway.event('message.complete', 'rt-s9', { status: 'complete', text: 'done' });
  await flush();
  gateway.event('message.start', 'rt-s9');
  await flush();
  assert.equal(revParses.length, 2, 'the next turn is a new baseline');
  controller.dispose();
});

test('a session.info event that moves the working directory is followed', async () => {
  const { gateway, controller, snap } = await setup('/work/one');
  controller.openSession({ id: 's9', title: 'old' });
  await flush();
  gateway.event('session.info', 'rt-s9', { model: 'm', provider: 'p', cwd: '/work/two' });
  await flush();
  assert.equal(snap().entries.s9.cwd, '/work/two');
  controller.dispose();
});

test('a gateway that reports no cwd leaves the turn without a baseline and asks nothing', async () => {
  const { gateway, controller, revParses, snap } = await setup(undefined);
  controller.openSession({ id: 's9', title: 'old' });
  await flush();
  gateway.event('message.start', 'rt-s9');
  await flush();
  assert.equal(snap().entries.s9.cwd, null);
  assert.equal(controller.openCwd(), null);
  assert.equal(revParses.length, 0);
  controller.dispose();
});

test('a directory that is not a repo records no baseline', async () => {
  const { gateway, controller, revParses } = await setup('/tmp/plain', null);
  controller.openSession({ id: 's9', title: 'old' });
  await flush();
  gateway.event('message.start', 'rt-s9');
  await flush();
  assert.equal(revParses.length, 1);
  assert.equal(turnBaseFor('/tmp/plain'), null);
  controller.dispose();
});

test('only a session that goes idle to running, with a known cwd, starts a baseline', () => {
  const entry = (running: boolean, cwd: string | null) => ({ transcript: { running }, cwd });
  const idle = { a: entry(false, '/a'), b: entry(true, '/b'), c: entry(false, null) };
  const next = { a: entry(true, '/a'), b: entry(true, '/b'), c: entry(true, null), d: entry(true, '/d') };
  assert.deepEqual(startedTurnCwds(idle, next), ['/a', '/d']);
  assert.deepEqual(startedTurnCwds(next, next), []);
});
