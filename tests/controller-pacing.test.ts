import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController } from '../src/chat/controller.ts';
import { STREAM_NOTIFY_MS, type ThrottleClock } from '../src/chat/notifyThrottle.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';
import { FakeGateway, flush } from './support/gateway.ts';

function wound() {
  let now = 5_000;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: ThrottleClock = {
    now: () => now,
    after: (ms, run) => {
      const id = (nextId += 1);
      timers.set(id, { at: now + ms, run });
      return () => timers.delete(id);
    },
    microtask: (run) => queueMicrotask(run),
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
    },
  };
}

async function setup(history: unknown[] = []) {
  const gateway = new FakeGateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.resume'] = (p) => ({ session_id: `rt-${p.session_id}`, message_count: 0, messages: [], info: {} });
  const api: GatewayApi = {
    get: async <T>(path: string) => (path.includes('/messages') ? ({ messages: history } as T) : ({ sessions: [] } as T)),
    post: async <T>() => ({}) as T,
    put: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    del: async <T>() => ({}) as T,
  };
  const link = new GatewayLink({
    mintUrl: async () => 'wss://gw/api/ws?ticket=t',
    onAuthRejected: () => undefined,
    socketFactory: () => gateway as unknown as WebSocket,
  });
  const time = wound();
  const controller = new ChatController(link, api, 'default', null, time.clock);
  controller.start();
  await flush();
  gateway.open();
  await flush();
  controller.openSession({ id: 's1', title: 'one' });
  await flush();
  let heard = 0;
  controller.subscribe(() => (heard += 1));
  return { gateway, controller, time, heard: () => heard, snap: () => controller.getSnapshot() };
}

const HISTORY = [
  { id: 1, role: 'user', content: 'hi' },
  { id: 2, role: 'assistant', content: 'hello' },
];

test('a stream of deltas wakes the subscribers once per beat while the snapshot stays current', async () => {
  const { gateway, controller, time, heard, snap } = await setup(HISTORY);
  gateway.event('message.start', 'rt-s1');
  await flush();
  const base = heard();

  for (let i = 0; i < 300; i += 1) gateway.event('message.delta', 'rt-s1', { text: 'w ' });
  const part = snap().entries.s1.transcript.messages.at(-1)!.parts[0];
  assert.equal(part.kind === 'text' ? part.text.length : -1, 600, 'every delta is already in the snapshot');
  assert.ok(heard() - base <= 1, `300 deltas woke the subscribers ${heard() - base} times`);

  time.advance(STREAM_NOTIFY_MS);
  assert.equal(heard() - base <= 2, true, 'the trailing beat is one more wake-up');
  const after = heard();
  time.advance(STREAM_NOTIFY_MS * 10);
  assert.equal(heard(), after, 'and then it is quiet');
  controller.dispose();
});

test('the last delta of a burst is always announced by a trailing beat', async () => {
  const { gateway, controller, time, heard } = await setup(HISTORY);
  gateway.event('message.start', 'rt-s1');
  gateway.event('message.delta', 'rt-s1', { text: 'a' });
  await flush();
  const before = heard();
  gateway.event('message.delta', 'rt-s1', { text: 'b' });
  gateway.event('message.delta', 'rt-s1', { text: 'c' });
  assert.equal(heard(), before, 'inside the interval nothing is announced yet');
  time.advance(STREAM_NOTIFY_MS);
  assert.equal(heard(), before + 1);
  controller.dispose();
});

test('a boundary event notifies on the spot and covers the deltas still waiting', async () => {
  const { gateway, controller, heard, snap } = await setup(HISTORY);
  gateway.event('message.start', 'rt-s1');
  gateway.event('message.delta', 'rt-s1', { text: 'a' });
  gateway.event('message.delta', 'rt-s1', { text: 'b' });
  await flush();
  const before = heard();

  gateway.event('tool.start', 'rt-s1', { tool_id: 't1', name: 'terminal', context: 'ls' });
  assert.ok(heard() > before, 'a tool starting is not paced');
  const announced = heard();
  gateway.event('tool.complete', 'rt-s1', { tool_id: 't1', name: 'terminal' });
  assert.ok(heard() > announced, 'nor is it finishing');
  const settled = heard();
  gateway.event('message.complete', 'rt-s1', { status: 'complete' });
  assert.ok(heard() > settled, 'nor the end of the turn');
  assert.equal(snap().entries.s1.transcript.running, false);
  controller.dispose();
});

test('a delta that opens a turn is not paced: the turn edge reaches everything that watches it', async () => {
  const { gateway, controller, heard, snap } = await setup(HISTORY);
  const before = heard();
  gateway.event('message.delta', 'rt-s1', { text: 'first words, no message.start' });
  assert.equal(snap().entries.s1.transcript.running, true);
  assert.ok(heard() > before);
  controller.dispose();
});

test('an event that changes nothing leaves the snapshot and the subscribers alone', async () => {
  const { gateway, controller, heard, snap } = await setup(HISTORY);
  gateway.event('message.start', 'rt-s1');
  await flush();
  const before = snap();
  const woke = heard();
  gateway.event('message.delta', 'rt-s1', { text: '' });
  gateway.event('status.update', 'rt-s1', { kind: 'nothing' });
  assert.equal(heard(), woke);
  assert.equal(snap(), before);
  controller.dispose();
});

test('streaming into one chat keeps every other chat, and the settled messages, as they were', async () => {
  const { gateway, controller, snap } = await setup(HISTORY);
  controller.openSession({ id: 's2', title: 'two' });
  await flush();
  controller.openSession({ id: 's1', title: 'one' });
  const other = snap().entries.s2;
  const settled = snap().entries.s1.transcript.messages.slice();
  gateway.event('message.start', 'rt-s1');
  for (let i = 0; i < 20; i += 1) gateway.event('message.delta', 'rt-s1', { text: 'x' });
  await flush();

  assert.equal(snap().entries.s2, other);
  settled.forEach((message, i) => assert.equal(snap().entries.s1.transcript.messages[i], message));
  controller.dispose();
});

test('the live model is one object while its inputs are unchanged', async () => {
  const { controller, snap } = await setup(HISTORY);
  await controller.selectModel({ model: 'm', provider: 'p', effort: null });
  const first = controller.currentModel();
  assert.ok(first);
  assert.equal(controller.currentModel(), first);
  assert.equal(snap().entries.s1.model?.model, 'm');
  await controller.selectModel({ model: 'm2', provider: 'p', effort: null });
  assert.notEqual(controller.currentModel(), first);
  controller.dispose();
});
