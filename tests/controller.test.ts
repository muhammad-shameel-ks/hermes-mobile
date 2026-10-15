import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController, DRAFT_KEY } from '../src/chat/controller.ts';
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

test('the first send creates the session lazily and the reply streams into it', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: {} });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });

  await controller.send('hello');
  await flush();
  assert.deepEqual(gateway.called('session.create')[0].params, { profile: 'default', source: 'desktop', cols: 96 });
  assert.equal(gateway.called('prompt.submit')[0].params.session_id, 'rt-1');
  assert.equal(snap().openKey, 's1');
  assert.equal(snap().entries[DRAFT_KEY].transcript.messages.length, 0, 'the draft is fresh again');

  gateway.event('message.start', 'rt-1');
  gateway.event('message.delta', 'rt-1', { text: 'Hi there' });
  gateway.event('message.complete', 'rt-1', { status: 'complete' });
  await flush();
  const t = snap().entries.s1.transcript;
  assert.equal(t.running, false);
  assert.deepEqual(
    t.messages.map((m) => m.role),
    ['user', 'assistant'],
  );
  controller.dispose();
});

test('a roster tap finds the Bot Chat by title, follows the profile and loads history', async () => {
  const { gateway, controller, snap, restCalls } = await setup({
    'bc-1': [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'yes' }],
  });
  gateway.handlers['session.list'] = () => ({ sessions: [{ id: 'bc-0', resolved_id: 'bc-1', title: 'Bot Chat' }] });

  await controller.openBot({ name: 'scout', label: 'Scout' });
  await flush();
  assert.deepEqual(gateway.called('session.list')[0].params, { profile: 'scout', title: 'Bot Chat', limit: 200, include_hidden: true });
  assert.equal(snap().profile, 'scout');
  assert.equal(snap().openKey, 'bc-1', 'the compression tip opens, not the root');
  assert.equal(snap().entries['bc-1'].isBotChat, true);
  assert.equal(gateway.called('session.resume')[0].params.profile, 'scout');
  assert.ok(restCalls.some((p) => p.startsWith('/api/sessions/bc-1/messages')));
  assert.equal(snap().entries['bc-1'].transcript.messages.length, 2);
  controller.dispose();
});

test('a bot without a Bot Chat gets one created hidden and titled', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.list'] = () => ({ sessions: [] });
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-b', stored_session_id: 'b1', message_count: 0, messages: [], info: {} });
  gateway.handlers['session.title'] = () => ({});

  await controller.openBot({ name: 'scout', label: 'Scout' });
  await flush();
  assert.deepEqual(gateway.called('session.create')[0].params, {
    profile: 'scout',
    title: 'Bot Chat',
    hidden: true,
    follow_profile_config: true,
  });
  assert.equal(gateway.called('session.title')[0].params.title, 'Bot Chat');
  assert.equal(snap().openKey, 'b1');
  assert.equal(gateway.called('prompt.submit').length, 0, 'a row tap never kicks off');
  controller.dispose();
});

test('a failed Bot Chat lookup fails closed: no profile switch, the screen stays put', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.list'] = () => {
    throw new Error('registry unavailable');
  };

  await controller.openBot({ name: 'scout', label: 'Scout' });
  await flush();
  assert.equal(snap().profile, 'default');
  assert.equal(snap().openKey, DRAFT_KEY);
  assert.equal(snap().openingBot, null);
  assert.equal(gateway.called('session.create').length, 0, 'a failed lookup never mints a second chat');
  assert.match(snap().notice?.text ?? '', /Could not open Scout.s chat.*registry unavailable/);
  controller.dispose();
});

test('a failed Bot Chat creation leaves the active profile alone', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.list'] = () => ({ sessions: [] });
  gateway.handlers['session.create'] = () => {
    throw new Error('no model');
  };

  await controller.openBot({ name: 'scout', label: 'Scout' });
  await flush();
  assert.equal(snap().profile, 'default');
  assert.equal(snap().openKey, DRAFT_KEY);
  controller.dispose();
});

test('a new bot is created with its picked look and picture, and its Bot Chat is kicked off', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.list'] = () => ({ sessions: [] });
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-b', stored_session_id: 'b1', message_count: 0, messages: [], info: {} });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });

  const created = await controller.createBot(
    { label: 'Scout', description: 'Finds things' },
    { shape: 'blobatar:k3j9:sun', color: null, image: 'data:image/png;base64,AAAA' },
  );
  await flush();
  assert.equal(created, true);
  const configure = gateway.called('profiles.configure')[0].params as { name: string; ui_meta: { 'hermes-bots': Record<string, unknown> } };
  assert.equal(configure.name, 'scout');
  const meta = configure.ui_meta['hermes-bots'];
  assert.equal(meta.shape, 'blobatar:k3j9:sun');
  assert.equal(meta.imageKind, 'photo');
  assert.equal('color' in meta, false, 'no pick keeps the name-derived hue');
  assert.equal('image' in meta, false, 'the picture never rides ui_meta');
  assert.deepEqual(gateway.called('profiles.set_asset')[0].params, { name: 'scout', asset: 'avatar', data: 'data:image/png;base64,AAAA' });
  assert.equal(snap().profile, 'scout');
  assert.equal(gateway.called('prompt.submit').length, 1, 'a created bot introduces itself');
  controller.dispose();
});

test('Create while a create is under way joins it instead of making a second profile', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['session.list'] = () => ({ sessions: [{ id: 'bc', title: 'Bot Chat' }] });
  const first = controller.createBot({ label: 'Scout', description: '' });
  const second = controller.createBot({ label: 'Scout', description: '' });
  assert.equal(first, second);
  await first;
  assert.equal(gateway.called('profiles.create').length, 1);
  controller.dispose();
});

test('editing a bot patches only what changed and clears a removed picture', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['profiles.list'] = () => ({
    profiles: [{ name: 'scout', path: '/p', ui_meta: { 'hermes-bots': { title: 'Scout', shape: 'blobatar' } }, ui_meta_revisions: { 'hermes-bots': 3 } }],
  });
  await controller.refreshRoster();
  const bot = controller.getSnapshot().roster.visible[0];

  await controller.editBot(bot, { label: 'Scout', description: 'Finds things' }, { image: null, imageKind: 'shape', custom: true });
  const configure = gateway.called('profiles.configure').find((c) => 'ui_meta' in c.params)!.params as { ui_meta: { 'hermes-bots': Record<string, unknown> } };
  assert.deepEqual(configure.ui_meta['hermes-bots'], { title: 'Scout', shape: 'blobatar', imageKind: 'shape', custom: true });
  assert.deepEqual(gateway.called('profiles.set_asset')[0].params, { name: 'scout', asset: 'avatar', clear: true });

  gateway.calls.length = 0;
  await controller.editBot(bot, { label: 'Scout', description: 'Finds things' }, null);
  assert.equal(gateway.called('profiles.set_asset').length, 0, 'an untouched look writes nothing');
  assert.equal(gateway.calls.filter((c) => c.method === 'profiles.configure' && 'ui_meta' in c.params).length, 0);
  controller.dispose();
});

test('/new in a Bot Chat compacts instead of resetting', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['session.list'] = () => ({ sessions: [{ id: 'bc', title: 'Bot Chat' }] });
  gateway.handlers['session.compress'] = () => ({ messages: [{ role: 'assistant', content: 'summary' }] });
  await controller.openBot({ name: 'scout', label: 'Scout' });
  await flush();

  await controller.send('/new');
  await flush();
  assert.equal(gateway.called('session.compress').length, 1);
  assert.equal(snap().openKey, 'bc');
  assert.match(snap().notice?.text ?? '', /never resets/);
  controller.dispose();
});

test('Send while a turn runs steers it', async () => {
  const { gateway, controller } = await setup();
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: {} });
  gateway.handlers['session.redirect'] = () => ({ status: 'redirected', text: 'also this' });
  await controller.send('first');
  await flush();
  gateway.event('message.start', 'rt-1');
  await flush();
  await controller.send('also this');
  await flush();
  assert.deepEqual(gateway.called('session.redirect')[0].params, { session_id: 'rt-1', profile: 'default', text: 'also this' });
  controller.dispose();
});

test('a draft keeps its model pick for session.create; a live session switches over config.set', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['model.options'] = () => ({ providers: [{ slug: 'nous', name: 'Nous', models: ['a', 'b'] }], model: 'a', provider: 'nous' });
  await controller.refreshModels();
  assert.deepEqual(snap().models.current, { model: 'a', provider: 'nous' });

  await controller.selectModel({ model: 'b', provider: 'nous', effort: 'high' });
  assert.equal(gateway.called('config.set').length, 0, 'a draft has no session to configure');
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: { model: 'b', provider: 'nous' } });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  await controller.send('hello');
  await flush();
  const create = gateway.called('session.create')[0].params;
  assert.equal(create.model, 'b');
  assert.equal(create.provider, 'nous');
  assert.equal(create.reasoning_effort, 'high');
  assert.equal(snap().entries.s1.model?.model, 'b');

  gateway.handlers['config.set'] = (p) =>
    p.confirm_expensive_model ? { key: 'model', info: { model: 'a', provider: 'nous' } } : { key: 'model', confirm_required: true, confirm_message: 'Pricey.' };
  const asked = await controller.selectModel({ model: 'a', provider: 'nous' });
  assert.deepEqual(asked, { kind: 'confirm', message: 'Pricey.' });
  assert.equal(snap().entries.s1.model?.model, 'b', 'an unconfirmed switch rolls back');
  const done = await controller.selectModel({ model: 'a', provider: 'nous' }, { confirm: true });
  assert.equal(done.kind, 'ok');
  assert.deepEqual(gateway.called('config.set')[1].params, {
    session_id: 'rt-1',
    profile: 'default',
    key: 'model',
    value: 'a --provider nous',
    confirm_expensive_model: true,
  });
  assert.equal(snap().entries.s1.model?.model, 'a');
  controller.dispose();
});
