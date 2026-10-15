import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController } from '../src/chat/controller.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';

type Handler = (params: Record<string, unknown>) => unknown;

/** A scripted gateway on the far side of a fake socket: answers RPCs, pushes events and requests. */
class FakeGateway extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  responses: Array<{ id: string; result?: unknown; error?: unknown }> = [];
  handlers: Record<string, Handler> = {};
  send(text: string) {
    const frame = JSON.parse(text) as { id?: string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
    if (!frame.method) {
      this.responses.push(frame as { id: string });
      return;
    }
    this.calls.push({ method: frame.method, params: frame.params ?? {} });
    const handler = this.handlers[frame.method];
    queueMicrotask(() => {
      try {
        const result = handler ? handler(frame.params ?? {}) : {};
        this.push({ jsonrpc: '2.0', id: frame.id, result });
      } catch (error) {
        this.push({ jsonrpc: '2.0', id: frame.id, error: { code: 4000, message: (error as Error).message } });
      }
    });
  }
  push(frame: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }));
  }
  event(type: string, sessionId: string, payload: unknown = {}) {
    this.push({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sessionId, payload } });
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, reason: '' }));
  }
  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function setup(history: Record<string, unknown[]> = {}) {
  const gateway = new FakeGateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.resume'] = (p) => ({ session_id: `rt-${p.session_id}`, message_count: 0, messages: [], info: {} });
  const restCalls: string[] = [];
  const api: GatewayApi = {
    get: async <T>(path: string) => {
      restCalls.push(path);
      const match = /\/api\/sessions\/([^/]+)\/messages/.exec(path);
      if (match) return { messages: history[decodeURIComponent(match[1])] ?? [] } as T;
      return { sessions: [] } as T;
    },
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
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
  return { gateway, controller, restCalls, snap: () => controller.getSnapshot() };
}


/** one open session with a turn running: `rt-1` / `s1` */
async function running() {
  const ctx = await setup();
  const { gateway, controller } = ctx;
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: {} });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  gateway.handlers['session.redirect'] = () => ({ status: 'redirected', text: '' });
  gateway.handlers['session.interrupt'] = () => ({ status: 'interrupted' });
  await controller.send('first');
  await flush();
  gateway.event('message.start', 'rt-1');
  await flush();
  const stack = () => ctx.snap().entries.s1.stack;
  const submits = () => gateway.called('prompt.submit').map((c) => c.params.text);
  const endTurn = async () => {
    gateway.event('message.complete', 'rt-1', { status: 'complete' });
    await flush();
  };
  return { ...ctx, stack, submits, endTurn };
}

test('a steer the turn declines is queued instead of lost, and drains when the turn ends', async () => {
  const { gateway, controller, stack, submits, snap, endTurn } = await running();
  gateway.handlers['session.redirect'] = () => ({ status: 'rejected', text: '' });
  await controller.send('also this');
  await flush();
  assert.deepEqual(stack().queue.entries.map((e) => e.text), ['also this']);
  assert.equal(snap().entries.s1.transcript.messages.filter((m) => m.role === 'user').length, 1, 'the declined correction leaves no bubble');

  await endTurn();
  assert.deepEqual(submits(), ['first', 'also this']);
  assert.deepEqual(stack().queue.entries, []);
  assert.equal(snap().entries.s1.transcript.running, true);
  controller.dispose();
});

test('the queue control holds text for after the turn, one prompt at a time', async () => {
  const { controller, gateway, stack, submits, endTurn } = await running();
  controller.queueMessage('one');
  controller.queueMessage('two');
  await flush();
  assert.equal(gateway.called('session.redirect').length, 0);
  assert.deepEqual(stack().queue.entries.map((e) => e.text), ['one', 'two']);

  await endTurn();
  assert.deepEqual(submits(), ['first', 'one']);
  await endTurn();
  assert.deepEqual(submits(), ['first', 'one', 'two']);
  controller.dispose();
});

test('Stop parks the queue: the end of the turn does not fire it, and resuming does', async () => {
  const { controller, gateway, stack, submits } = await running();
  controller.queueMessage('later');
  await controller.stop();
  await flush();
  assert.equal(gateway.called('session.interrupt').length, 1);
  assert.equal(stack().queue.parked, true);

  gateway.event('message.complete', 'rt-1', { status: 'interrupted' });
  await flush();
  assert.deepEqual(submits(), ['first']);
  assert.deepEqual(stack().queue.entries.map((e) => e.text), ['later']);

  controller.queue.resume('s1');
  await flush();
  assert.deepEqual(submits(), ['first', 'later']);
  assert.equal(stack().queue.parked, false);
  controller.dispose();
});

test('a queued prompt the gateway refuses leaves no bubble and is retried, not looped', async () => {
  const { controller, gateway, stack, snap, endTurn } = await running();
  gateway.handlers['prompt.submit'] = () => {
    throw new Error('busy');
  };
  controller.queueMessage('stubborn');
  await endTurn();
  assert.equal(gateway.called('prompt.submit').length, 2, 'one attempt, then backoff');
  assert.deepEqual(stack().queue.entries.map((e) => [e.text, e.drainFailures]), [['stubborn', 1]]);
  assert.equal(snap().entries.s1.transcript.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(snap().entries.s1.transcript.running, false);
  controller.dispose();
});

test('a queued prompt never fires while the socket is closed and drains on the next open one', async () => {
  const { controller, gateway, submits, endTurn } = await running();
  controller.queueMessage('patient');
  gateway.close();
  await flush();
  await endTurn();
  assert.deepEqual(submits(), ['first']);
  controller.dispose();
});

test('queued prompts and the folded choice are saved and restored through the stack store', async () => {
  const { controller, stack } = await running();
  const saved: Array<[string, string[], boolean]> = [];
  controller.stackStore = { load: async () => null, save: (key, value) => void saved.push([key, value.queue.map((e) => e.text), value.hidden]) };
  controller.queueMessage('keep me');
  controller.setStackHidden('s1', true);
  assert.deepEqual(saved, [['s1', ['keep me'], false], ['s1', ['keep me'], true]]);
  assert.equal(stack().hidden, true);
  controller.dispose();
});

test('status events build the stack: todos, a subagent and a background task', async () => {
  const { controller, gateway, stack } = await running();
  gateway.handlers['process.list'] = () => ({ processes: [{ session_id: 'p1', command: 'npm run dev', status: 'running' }] });
  gateway.event('todo.updated', 'rt-1', { todos: [{ id: 'a', content: 'Write it', status: 'in_progress' }], revision: 1 });
  gateway.event('subagent.start', 'rt-1', { subagent_id: 'sa', goal: 'Dig', task_count: 1, task_index: 0 });
  gateway.event('tool.complete', 'rt-1', { name: 'terminal', tool_id: 't', result: '' });
  await flush();
  assert.deepEqual(stack().status.todos?.map((t) => t.content), ['Write it']);
  assert.deepEqual(stack().status.subagents.map((s) => s.goal), ['Dig']);
  assert.deepEqual(stack().status.background.map((b) => b.title), ['npm run dev']);
  assert.equal(gateway.called('process.list')[0].params.session_id, 'rt-1');
  controller.dispose();
});

test('resuming a session hydrates its todos and reads the goal from the session controls', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.resume'] = (p) => ({
    session_id: `rt-${p.session_id}`,
    message_count: 0,
    messages: [],
    info: {},
    running: true,
    todo_state: { todos: [{ id: 'a', content: 'Plan', status: 'pending' }], revision: 2 },
  });
  gateway.handlers['session.control.read'] = () => ({
    control: { goal: { title: 'Ship', status: 'active', turns_used: 1, max_turns: 5, contract: {}, subgoals: [], gates: [] }, loop: null, heartbeat: null, revision: 'r', updated_at: 1 },
  });
  controller.openSession({ id: 'old', title: 'Old' });
  await flush();
  const { status } = snap().entries.old.stack;
  assert.deepEqual(status.todos?.map((t) => t.content), ['Plan']);
  assert.equal(status.control.goal?.title, 'Ship');
  controller.dispose();
});

test('a restored queue is parked until the session is idle, then drains once it has loaded', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  controller.stackStore = {
    load: async () => ({ queue: [{ id: 'q-old', text: 'left from last time', queuedAt: 1 }], hidden: true }),
    save: () => undefined,
  };
  controller.openSession({ id: 'old', title: 'Old' });
  await flush();
  assert.equal(gateway.called('prompt.submit')[0].params.text, 'left from last time');
  assert.equal(snap().entries.old.stack.hidden, true);
  assert.deepEqual(snap().entries.old.stack.queue.entries, []);
  controller.dispose();
});
