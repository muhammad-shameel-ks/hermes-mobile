import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController } from '../src/chat/controller.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';
import { FakeGateway, flush } from './support/gateway.ts';

async function setup(stored: { on: boolean }) {
  const gateway = new FakeGateway();
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  const api: GatewayApi = {
    get: async <T>(path: string) => (path === '/api/config' ? ({ display: { message_reactions: stored.on } } as T) : ({ sessions: [] } as T)),
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
  return { gateway, controller };
}

test('turning reactions on writes the display toggle and re-reads the config', async () => {
  const stored = { on: false };
  const { gateway, controller } = await setup(stored);
  assert.equal(controller.getSnapshot().reactionsEnabled, false);
  gateway.handlers['config.set'] = (p) => {
    stored.on = p.value === 'true';
    return { key: p.key, value: stored.on };
  };
  await controller.setReactionsEnabled(true);
  await flush();
  assert.deepEqual(gateway.calls.filter((c) => c.method === 'config.set').at(-1)?.params, { key: 'display.message_reactions', value: 'true', profile: 'default' });
  assert.equal(controller.getSnapshot().reactionsEnabled, true);
});

test('a refused write puts the switch back and says so', async () => {
  const stored = { on: false };
  const { gateway, controller } = await setup(stored);
  gateway.handlers['config.set'] = () => {
    throw new Error('read-only config');
  };
  await controller.setReactionsEnabled(true);
  await flush();
  assert.equal(controller.getSnapshot().reactionsEnabled, false);
  assert.match(controller.getSnapshot().notice?.text ?? '', /Could not change message reactions\. .*read-only config/);
});
