import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController, DRAFT_KEY } from '../src/chat/controller.ts';
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
        this.push({ jsonrpc: '2.0', id: frame.id, error: { code: 4000, message: (error as Error).message } });
      }
    });
  }
  push(frame: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }));
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function setup() {
  const gateway = new FakeGateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: {} });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  const api: GatewayApi = {
    get: async <T>() => ({ sessions: [], messages: [] }) as T,
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
  return { gateway, controller, snap: () => controller.getSnapshot() };
}

const lastNotice = (snap: () => ReturnType<ChatController['getSnapshot']>, key: string) => snap().entries[key]?.transcript.messages.at(-1);

test('/new on a draft stays a draft and sends nothing', async () => {
  const { gateway, controller, snap } = await setup();
  await controller.send('/new');
  await flush();
  assert.equal(snap().openKey, DRAFT_KEY);
  assert.equal(gateway.called('session.create').length, 0);
  assert.equal(gateway.called('prompt.submit').length, 0);
  controller.dispose();
});

test('/compact on a draft says there is nothing to compress instead of sending it as a prompt', async () => {
  const { gateway, controller, snap } = await setup();
  await controller.send('/compact');
  await flush();
  assert.equal(gateway.called('prompt.submit').length, 0);
  assert.match(lastNotice(snap, DRAFT_KEY)?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('') ?? '', /Nothing to compress/);
  controller.dispose();
});

test('a command that needs a session creates it from the draft and prints into it', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['slash.exec'] = () => ({ output: 'Hermes 9.9' });
  await controller.send('/version');
  await flush();
  assert.equal(gateway.called('session.create').length, 1);
  assert.deepEqual(gateway.called('slash.exec')[0].params, { session_id: 'rt-1', command: 'version', profile: 'default' });
  assert.equal(snap().openKey, 's1');
  const text = lastNotice(snap, 's1')?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('');
  assert.equal(text, '/version\nHermes 9.9');
  assert.equal(snap().entries[DRAFT_KEY].transcript.messages.length, 0, 'the draft is fresh again');
  controller.dispose();
});

test('/compress carries its focus topic to session.compress', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['session.compress'] = () => ({ messages: [{ role: 'assistant', content: 'summary' }] });
  await controller.send('hello');
  await flush();
  gateway.push({ jsonrpc: '2.0', method: 'event', params: { type: 'message.complete', session_id: 'rt-1', payload: { status: 'complete', text: 'hi' } } });
  await flush();
  await controller.send('/compress the parser');
  await flush();
  assert.deepEqual(gateway.called('session.compress')[0].params, { session_id: 'rt-1', profile: 'default', focus_topic: 'the parser' });
  controller.dispose();
});

test('a skill command shows its invocation in the bubble and sends the expanded body', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['slash.exec'] = () => {
    throw new Error('not a worker command');
  };
  gateway.handlers['command.dispatch'] = () => ({ type: 'skill', name: 'work', message: '[skill body]', display: '/work fix it' });
  await controller.send('/work fix it');
  await flush();
  assert.equal(gateway.called('prompt.submit')[0].params.text, '[skill body]');
  const users = snap().entries.s1.transcript.messages.filter((m) => m.role === 'user');
  assert.deepEqual(users.map((m) => m.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('')), ['/work fix it']);
  controller.dispose();
});

test('the completion helper carries a raw gateway call', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['complete.path'] = () => ({ items: [{ text: '@file:a.ts' }] });
  const result = await controller.request<{ items: Array<{ text: string }> }>('complete.path', { word: '@a' });
  assert.deepEqual(result.items, [{ text: '@file:a.ts' }]);
  assert.deepEqual(gateway.called('complete.path')[0].params, { word: '@a' });
  controller.dispose();
});
