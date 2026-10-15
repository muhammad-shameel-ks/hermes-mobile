import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileAttachment, imageAttachment } from '../src/chat/attachments.ts';
import { ChatController } from '../src/chat/controller.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';

class Gateway extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  handlers: Record<string, (params: Record<string, unknown>) => unknown> = {};
  send(text: string) {
    const frame = JSON.parse(text) as { id?: string; method?: string; params?: Record<string, unknown> };
    if (!frame.method) return;
    this.calls.push({ method: frame.method, params: frame.params ?? {} });
    queueMicrotask(() => {
      try {
        const result = this.handlers[frame.method!]?.(frame.params ?? {}) ?? {};
        this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) }));
      } catch (error) {
        const body = { jsonrpc: '2.0', id: frame.id, error: { code: 4000, message: (error as Error).message } };
        this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(body) }));
      }
    });
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

async function setup() {
  const gateway = new Gateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: {} });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  gateway.handlers['image.attach_bytes'] = () => ({ attached: true, path: '/images/shot.png' });
  gateway.handlers['file.attach'] = () => ({ attached: true, ref_text: '@file:attachments/notes.txt' });
  const api: GatewayApi = {
    get: async <T>() => ({ sessions: [] }) as T,
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
  controller.readAttachment = async () => 'QUJD';
  controller.start();
  await flush();
  gateway.open();
  await flush();
  return { gateway, controller, snap: () => controller.getSnapshot() };
}

const shot = imageAttachment({ uri: 'file:///cache/shot.png', fileName: 'shot.png', mimeType: 'image/png', fileSize: 3 });
const notes = fileAttachment({ uri: 'file:///cache/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 3 });

test('a first send with attachments stages them in the new session before the prompt carries their refs', async () => {
  const { gateway, controller, snap } = await setup();
  await controller.send('what is in these', [shot, notes]);
  await flush();

  const order = gateway.calls.map((c) => c.method).filter((m) => ['session.create', 'image.attach_bytes', 'file.attach', 'prompt.submit'].includes(m));
  assert.deepEqual(order, ['session.create', 'image.attach_bytes', 'file.attach', 'prompt.submit']);
  assert.deepEqual(gateway.called('image.attach_bytes')[0].params, { session_id: 'rt-1', profile: 'default', content_base64: 'QUJD', filename: 'shot.png' });
  assert.equal(gateway.called('file.attach')[0].params.data_url, 'data:text/plain;base64,QUJD');
  assert.equal(gateway.called('prompt.submit')[0].params.text, '@file:attachments/notes.txt\n\nwhat is in these');
  const first = snap().entries.s1.transcript.messages[0].parts[0];
  assert.equal(first.kind === 'text' && first.text, 'what is in these');
  controller.dispose();
});

test('an image sent alone asks the desktop question and shows its name in the bubble', async () => {
  const { gateway, controller, snap } = await setup();
  await controller.send('', [shot]);
  await flush();
  assert.equal(gateway.called('prompt.submit')[0].params.text, 'What do you see in this image?');
  const first = snap().entries.s1.transcript.messages[0].parts[0];
  assert.equal(first.kind === 'text' && first.text, 'shot.png');
  controller.dispose();
});

test('a failed upload sends no prompt, detaches what was queued and says so', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['file.attach'] = () => {
    throw new Error('no room');
  };
  gateway.handlers['image.detach'] = () => ({ detached: true });
  await controller.send('go', [shot, notes]);
  await flush();
  assert.equal(gateway.called('prompt.submit').length, 0);
  assert.deepEqual(gateway.called('image.detach')[0].params, { session_id: 'rt-1', profile: 'default', path: '/images/shot.png' });
  const messages = snap().entries.s1.transcript.messages;
  const last = messages.at(-1)!.parts[0];
  assert.ok(last.kind === 'text' && last.text.includes('The message was not sent'));
  controller.dispose();
});

test('attachments wait for a running turn instead of steering it', async () => {
  const { gateway, controller, snap } = await setup();
  await controller.send('first');
  await flush();
  gateway.calls.length = 0;
  await controller.send('more', [notes]);
  assert.equal(gateway.called('session.redirect').length, 0);
  assert.equal(gateway.called('file.attach').length, 0);
  assert.ok(snap().notice?.text.includes('running turn'));
  controller.dispose();
});
