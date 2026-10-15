import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController } from '../src/chat/controller.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';

type Handler = (params: Record<string, unknown>) => unknown;

class FakeGateway extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  handlers: Record<string, Handler> = {};
  send(text: string) {
    const frame = JSON.parse(text) as { id?: string; method?: string; params?: Record<string, unknown> };
    if (!frame.method) return;
    this.calls.push({ method: frame.method, params: frame.params ?? {} });
    const handler = this.handlers[frame.method];
    queueMicrotask(() => {
      try {
        this.push({ jsonrpc: '2.0', id: frame.id, result: handler ? handler(frame.params ?? {}) : {} });
      } catch (error) {
        const { code, message } = error as { code?: number; message: string };
        this.push({ jsonrpc: '2.0', id: frame.id, error: { code: code ?? 4000, message } });
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
  close() {}
  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

const HISTORY = [
  { role: 'user', content: 'first', id: 10 },
  { role: 'assistant', content: 'one', id: 11 },
  { role: 'user', content: 'second', id: 12 },
  { role: 'assistant', content: 'two', id: 13 },
];

async function setup() {
  const gateway = new FakeGateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.resume'] = (p) => ({ session_id: `rt-${p.session_id}`, message_count: 0, messages: [], info: {} });
  const api: GatewayApi = {
    get: async <T>(path: string) => (/\/messages/.test(path) ? ({ messages: HISTORY } as T) : ({ sessions: [], display: { message_reactions: true } } as T)),
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
  const controller = new ChatController(link, api);
  controller.start();
  await flush();
  gateway.open();
  await flush();
  controller.openSession({ id: 's1', title: 'chat' });
  await flush();
  return { gateway, controller, messages: () => controller.getSnapshot().entries.s1.transcript.messages };
}

test('the display toggle for reactions is read from the profile config', async () => {
  const { controller } = await setup();
  assert.equal(controller.getSnapshot().reactionsEnabled, true);
  controller.dispose();
});

test('a reaction paints at once, persists against the row, and the gateway\'s list wins', async () => {
  const { gateway, controller, messages } = await setup();
  gateway.handlers['message.react'] = () => ({ row_id: 11, reactions: [{ emoji: '👍', author: 'user', at: 5 }] });
  const pending = controller.react('row-11', '👍');
  assert.deepEqual(messages()[1].reactions?.map((r) => r.emoji), ['👍'], 'painted before the round trip');
  await pending;
  assert.deepEqual(gateway.called('message.react')[0].params, { session_id: 'rt-s1', profile: 'default', row_id: 11, emoji: '👍', author: 'user' });
  assert.deepEqual(messages()[1].reactions, [{ emoji: '👍', author: 'user', at: 5 }]);
  controller.dispose();
});

test('a refused reaction rolls back and says so', async () => {
  const { gateway, controller, messages } = await setup();
  gateway.handlers['message.react'] = () => {
    throw Object.assign(new Error('message not found in this session'), { code: 4040 });
  };
  await controller.react('row-11', '❤️');
  assert.equal(messages()[1].reactions, undefined);
  assert.match(controller.getSnapshot().notice?.text ?? '', /Could not react/);
  controller.dispose();
});

test('retry rewinds to the prompt a reply answers: truncate by row id, rebind the survivors', async () => {
  const { gateway, controller, messages } = await setup();
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming', survivor_row_id_map: { '10': 20, '11': null, '12': null, '13': null }, user_row_id: 21 });
  const outcome = await controller.rewind('row-13');
  assert.equal(outcome, 'ok');
  const call = gateway.called('prompt.submit')[0].params;
  assert.deepEqual(call, {
    session_id: 'rt-s1',
    profile: 'default',
    text: 'second',
    confirm_truncate: true,
    truncate_before_row_id: 12,
    confirm_empty_truncate: true,
    rebind_survivor_row_ids: [10, 11, 12, 13],
  });
  assert.equal(gateway.called('session.interrupt').length, 0, 'an idle thread is not interrupted');
  assert.deepEqual(messages().map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(messages().map((m) => m.rowId), [20, undefined, 21]);
  assert.equal(controller.getSnapshot().entries.s1.transcript.running, true);
  controller.dispose();
});

test('a rewind discards the background rows of the abandoned turns: live processes are killed and a late process.list cannot bring them back', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['process.list'] = () => ({
    processes: [
      { session_id: 'p-live', command: 'npm run dev', status: 'running' },
      { session_id: 'p-done', command: 'make', status: 'exited', exit_code: 0 },
    ],
  });
  gateway.handlers['process.kill'] = () => ({ status: 'killed' });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  await controller.status.refreshProcesses('s1');
  assert.deepEqual(controller.getSnapshot().entries.s1.stack.status.background.map((b) => b.id), ['p-live', 'p-done']);

  assert.equal(await controller.rewind('row-13'), 'ok');
  await flush();
  assert.deepEqual(gateway.called('process.kill').map((c) => c.params.process_id), ['p-live'], 'only the running process is killed');
  assert.deepEqual(controller.getSnapshot().entries.s1.stack.status.background, []);

  await controller.status.refreshProcesses('s1');
  assert.deepEqual(controller.getSnapshot().entries.s1.stack.status.background, [], 'the registry still reports them; they stay gone');
  controller.dispose();
});

test('an edit of an older turn sends the new text; a running turn is interrupted first', async () => {
  const { gateway, controller } = await setup();
  gateway.event('message.start', 'rt-s1');
  await flush();
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  const outcome = await controller.rewind('row-10', { text: 'first, edited', confirmDeep: true });
  assert.equal(outcome, 'ok');
  assert.deepEqual(gateway.calls.map((c) => c.method).filter((m) => m === 'session.interrupt' || m === 'prompt.submit'), ['session.interrupt', 'prompt.submit']);
  const call = gateway.called('prompt.submit')[0].params;
  assert.equal(call.text, 'first, edited');
  assert.equal(call.confirm_deep_truncate, true);
  assert.equal(call.truncate_before_row_id, 10);
  controller.dispose();
});

test('a raced "session busy" is interrupted and retried until the turn lets go', async () => {
  const { gateway, controller } = await setup();
  let attempts = 0;
  gateway.handlers['prompt.submit'] = () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('session busy'), { code: 4009 });
    return { status: 'streaming' };
  };
  assert.equal(await controller.rewind('row-12'), 'ok');
  assert.equal(attempts, 3);
  assert.ok(gateway.called('session.interrupt').length >= 1);
  controller.dispose();
});

test('the gateway refusing a deep cut rolls the transcript back and asks for consent', async () => {
  const { gateway, controller, messages } = await setup();
  gateway.handlers['prompt.submit'] = (p) => {
    if (!p.confirm_deep_truncate) throw Object.assign(new Error('truncation would archive later user turns'), { code: 4033 });
    return { status: 'streaming' };
  };
  assert.equal(await controller.rewind('row-10'), 'confirm');
  assert.equal(messages().length, 4, 'nothing was cut');
  assert.equal(await controller.rewind('row-10', { confirmDeep: true }), 'ok');
  controller.dispose();
});

test('a prompt with no row id is found in the durable history by its text', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming', user_row_id: 40 });
  await controller.send('fresh one');
  await flush();
  gateway.event('message.complete', 'rt-s1', { status: 'complete', text: 'ok' });
  await flush();
  const sent = controller.getSnapshot().entries.s1.transcript.messages.find((m) => m.role === 'user' && m.id.startsWith('live-'));
  assert.equal(sent?.rowId, 40, 'the submit result stamps the optimistic prompt');

  const bare = controller.getSnapshot().entries.s1.transcript.messages.map((m) => (m === sent ? { ...m, rowId: undefined } : m));
  gateway.handlers['session.history'] = () => ({ count: 1, messages: [{ role: 'user', text: 'fresh one', row_id: 40 }] });
  controller['updateTranscript']('s1', (t) => ({ ...t, messages: bare }));
  assert.equal(await controller.rewind(sent!.id), 'ok');
  assert.equal(gateway.called('prompt.submit').at(-1)?.params.truncate_before_row_id, 40);
  controller.dispose();
});
