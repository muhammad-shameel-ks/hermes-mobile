import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReauthRequiredError } from '../src/auth/session.ts';
import { ApiError } from '../src/gateway/api.ts';
import { gatewaySocketUrl, GatewayLink, type LinkState } from '../src/gateway/link.ts';

/** Just enough of a WebSocket for JsonRpcGatewayClient: events, readyState, send, close. */
class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: string[] = [];
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  send(text: string) {
    this.sent.push(text);
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  serverClose(code: number) {
    this.readyState = WebSocket.CLOSED;
    const event = new Event('close') as Event & { code: number; reason: string };
    event.code = code;
    event.reason = '';
    this.dispatchEvent(event);
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.serverClose(1000);
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(mint: () => Promise<string> = async () => gatewaySocketUrl('https://gw:443', 't')) {
  const sockets: FakeSocket[] = [];
  const states: LinkState[] = [];
  const rejected: string[] = [];
  const link = new GatewayLink({
    mintUrl: mint,
    onAuthRejected: (reason) => rejected.push(reason),
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  link.onState((state) => states.push(state));
  return { link, sockets, states, rejected, last: () => states[states.length - 1] };
}

test('the socket URL swaps the scheme and carries the ticket', () => {
  assert.equal(gatewaySocketUrl('https://gw.example:443', 'a b'), 'wss://gw.example:443/api/ws?ticket=a%20b');
  assert.equal(gatewaySocketUrl('http://10.0.2.2:9119', 't'), 'ws://10.0.2.2:9119/api/ws?ticket=t');
});

test('resume mints, dials and reports open; onOpen fires', async () => {
  const { link, sockets, last } = harness();
  let opened = 0;
  link.onOpen(() => {
    opened += 1;
  });
  link.resume();
  await tick();
  assert.equal(last().kind, 'connecting');
  sockets[0].open();
  await tick();
  assert.equal(last().kind, 'open');
  assert.equal(opened, 1);
  link.pause();
});

test('a dropped socket waits and redials on the same client', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { link, sockets, last } = harness();
  link.resume();
  await tick();
  sockets[0].open();
  await tick();
  sockets[0].serverClose(1006);
  assert.equal(last().kind, 'waiting');
  t.mock.timers.tick(20_000);
  await tick();
  assert.equal(sockets.length, 2);
  link.pause();
});

test('a 4401 close during the handshake signs out instead of retrying', async () => {
  const { link, sockets, last, rejected } = harness();
  link.resume();
  await tick();
  sockets[0].serverClose(4401);
  await tick();
  assert.equal(last().kind, 'signed-out');
  assert.equal(rejected.length, 1);
});

test('a refused ticket or a dead refresh signs out', async () => {
  const refused = harness(async () => {
    throw new ApiError('POST', '/api/auth/ws-ticket', 403, '');
  });
  refused.link.resume();
  await tick();
  assert.equal(refused.last().kind, 'signed-out');

  const expired = harness(async () => {
    throw new ReauthRequiredError();
  });
  expired.link.resume();
  await tick();
  assert.equal(expired.last().kind, 'signed-out');
});

test('a session-authority gateway is reported as unsupported', async () => {
  const { link, sockets, last } = harness();
  link.resume();
  await tick();
  sockets[0].open();
  await tick();
  const frame = {
    jsonrpc: '2.0',
    method: 'event',
    params: { type: 'gateway.ready', payload: { session_authority: true } },
  };
  sockets[0].dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }));
  await tick();
  assert.equal(last().kind, 'unsupported');
});
