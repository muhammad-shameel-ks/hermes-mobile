import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatController } from '../src/chat/controller.ts';
import type { ToolPart } from '../src/chat/transcript.ts';
import type { GatewayApi } from '../src/gateway/api.ts';
import { GatewayLink } from '../src/gateway/link.ts';

type Handler = (params: Record<string, unknown>) => unknown;

/** A scripted gateway on the far side of a fake socket: answers RPCs, pushes events and server requests. */
class FakeGateway extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  responses: Array<{ id: string; result?: unknown; error?: { code: number; message: string } }> = [];
  handlers: Record<string, Handler>;
  constructor(handlers: Record<string, Handler> = {}) {
    super();
    this.handlers = handlers;
  }
  send(text: string) {
    const frame = JSON.parse(text) as { id?: string; method?: string; params?: Record<string, unknown> };
    if (!frame.method) {
      this.responses.push(frame as { id: string });
      return;
    }
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
  event(type: string, sessionId: string, payload: unknown = {}) {
    this.push({ jsonrpc: '2.0', method: 'event', params: { type, session_id: sessionId, payload } });
  }
  request(id: string, method: string, params: Record<string, unknown>) {
    this.push({ jsonrpc: '2.0', id, method, params });
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1006, reason: '' }));
  }
  called(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
  answerTo(id: string) {
    return this.responses.find((r) => r.id === id);
  }
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function setup() {
  const handlers: Record<string, Handler> = {};
  const dialed: FakeGateway[] = [];
  const gateway = new FakeGateway(handlers);
  dialed.push(gateway);
  gateway.handlers['profiles.list'] = () => ({ profiles: [{ name: 'default', path: '/p', is_default: true }] });
  gateway.handlers['session.create'] = () => ({ session_id: 'rt-1', stored_session_id: 's1', message_count: 0, messages: [], info: {} });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  gateway.handlers['session.resume'] = (p) => ({ session_id: `rt-${p.session_id}`, message_count: 0, messages: [], info: {} });
  const api: GatewayApi = {
    get: async <T>() => ({ sessions: [], messages: [] }) as T,
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    del: async <T>() => ({}) as T,
  };
  const link = new GatewayLink({
    mintUrl: async () => 'wss://gw/api/ws?ticket=t',
    onAuthRejected: () => undefined,
    // each redial gets its own socket, sharing the scripted handlers
    socketFactory: () => {
      const socket = dialed.length === 1 && dialed[0].calls.length === 0 && dialed[0].readyState === WebSocket.CONNECTING ? dialed[0] : new FakeGateway(handlers);
      if (!dialed.includes(socket)) dialed.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const controller = new ChatController(link, api);
  controller.start();
  await flush();
  gateway.open();
  await flush();
  return { gateway, dialed, controller, snap: () => controller.getSnapshot() };
}

/** a session that is mid-turn, so requests have a chat to land in */
async function running() {
  const harness = await setup();
  await harness.controller.send('do it');
  await flush();
  harness.gateway.event('message.start', 'rt-1');
  await flush();
  return { ...harness, requests: () => harness.snap().entries.s1.requests, transcript: () => harness.snap().entries.s1.transcript };
}

const approvalParams = (extra: Record<string, unknown> = {}) => ({ session_id: 'rt-1', request_id: 'q1', command: 'rm -rf build', description: 'delete build', ...extra });

test('the phone tells the gateway it answers server requests, once per socket', async () => {
  const { gateway, controller } = await setup();
  gateway.event('gateway.ready', '', {});
  await flush();
  assert.deepEqual(gateway.called('client.capabilities').map((c) => c.params), [{ server_requests: true }]);
  controller.dispose();
});

test('an approval parks as a card; Run answers the live request with `once`', async () => {
  const { gateway, controller, requests } = await running();
  gateway.handlers['approval.pending'] = () => ({ approvals: [] });
  gateway.request('srv-1', 'approval', approvalParams());
  await flush();
  assert.equal(requests().approvals.length, 1);
  assert.equal(requests().approvals[0].command, 'rm -rf build');
  assert.equal(gateway.answerTo('srv-1'), undefined, 'nothing is answered until the reader chooses');

  assert.equal(await controller.serverRequests.answerApproval('s1', 'q1', 'once'), true);
  await flush();
  assert.deepEqual(gateway.answerTo('srv-1'), { jsonrpc: '2.0', id: 'srv-1', result: { choice: 'once' } });
  assert.deepEqual(requests().approvals, []);
  assert.deepEqual(gateway.called('approval.pending')[0].params, { session_id: 'rt-1', profile: 'default' }, 'the next card is asked for after an answer');
  controller.dispose();
});

test('Reject and the session-wide choice answer with their own choice', async () => {
  const { gateway, controller, requests } = await running();
  gateway.handlers['approval.pending'] = () => ({ approvals: [] });
  gateway.request('srv-1', 'approval', approvalParams());
  gateway.request('srv-2', 'approval', approvalParams({ request_id: 'q2', command: 'ls' }));
  await flush();
  assert.deepEqual(requests().approvals.map((a) => a.requestId), ['q1', 'q2']);
  assert.equal(requests().approvalTotal, 2);

  await controller.serverRequests.answerApproval('s1', 'q1', 'deny');
  await controller.serverRequests.answerApproval('s1', 'q2', 'session');
  await flush();
  assert.deepEqual((gateway.answerTo('srv-1') as { result: unknown }).result, { choice: 'deny' });
  assert.deepEqual((gateway.answerTo('srv-2') as { result: unknown }).result, { choice: 'session' });
  controller.dispose();
});

test('an approval restored from approval.pending answers over approval.respond', async () => {
  const { gateway, controller, requests } = await running();
  gateway.handlers['approval.pending'] = () => ({ approvals: [{ request_id: 'q9', command: 'make', description: 'build' }] });
  gateway.handlers['approval.received'] = () => ({ acknowledged: true });
  gateway.handlers['approval.respond'] = () => ({ resolved: 1 });
  await controller.serverRequests.replayApprovals('s1');
  await flush();
  assert.equal(requests().approvals[0].requestId, 'q9');
  assert.equal(requests().approvals[0].serverRequestId, undefined);
  assert.deepEqual(gateway.called('approval.received')[0].params, { session_id: 'rt-1', profile: 'default', request_id: 'q9' });

  gateway.handlers['approval.pending'] = () => ({ approvals: [] });
  await controller.serverRequests.answerApproval('s1', 'q9', 'once');
  await flush();
  assert.deepEqual(gateway.called('approval.respond')[0].params, { all: false, choice: 'once', request_id: 'q9', session_id: 'rt-1', profile: 'default' });
  assert.deepEqual(requests().approvals, []);
  controller.dispose();
});

test('offline, an approval stays put and the reader is told it is still waiting', async () => {
  const { gateway, controller, snap, requests } = await running();
  gateway.request('srv-1', 'approval', approvalParams());
  await flush();
  gateway.close();
  await flush();
  assert.equal(await controller.serverRequests.answerApproval('s1', 'q1', 'once'), false);
  assert.match(snap().notice?.text ?? '', /still waiting for your answer/);
  assert.equal(requests().approvals.length, 1);
  assert.equal(gateway.answerTo('srv-1'), undefined);
  controller.dispose();
});

test('an approval timing out takes the card down and says why in the transcript', async () => {
  const { gateway, controller, requests, transcript } = await running();
  gateway.request('srv-1', 'approval', approvalParams());
  await flush();
  gateway.event('request.cancel', 'rt-1', { id: 'srv-1', method: 'approval', reason: 'timeout' });
  await flush();
  assert.deepEqual(requests().approvals, []);
  const last = transcript().messages.at(-1);
  assert.equal(last?.role, 'system');
  assert.match(last?.parts[0].kind === 'text' ? last.parts[0].text : '', /Approval timed out/);
  controller.dispose();
});

test('an approval another client answered, or a turn that ended, clears the card', async () => {
  const { gateway, controller, requests } = await running();
  gateway.request('srv-1', 'approval', approvalParams());
  await flush();
  gateway.event('approval.settled', 'rt-1', { prompt_id: 'srv-1' });
  await flush();
  assert.deepEqual(requests().approvals, []);

  gateway.request('srv-2', 'approval', approvalParams({ request_id: 'q2' }));
  await flush();
  gateway.event('message.complete', 'rt-1', { status: 'interrupted' });
  await flush();
  assert.deepEqual(requests().approvals, []);
  controller.dispose();
});

const clarifyParams = (extra: Record<string, unknown> = {}) => ({
  session_id: 'rt-1',
  questions: [
    { qid: 'q1', question: 'Which database?', choices: ['Postgres (Recommended)', 'SQLite'] },
    { qid: 'q2', question: 'Why?' },
  ],
  ...extra,
});

const toolStart = (gateway: FakeGateway) =>
  gateway.event('tool.start', 'rt-1', { tool_id: 'call-1', name: 'clarify', args: { questions: clarifyParams().questions } });

test('a clarify request arms the streamed tool row; confirm locks every question in order', async () => {
  const { gateway, controller, requests, transcript } = await running();
  gateway.handlers['clarify.lock'] = () => ({ status: 'ok' });
  toolStart(gateway);
  await flush();
  gateway.request('srv-c', 'clarify', clarifyParams());
  await flush();

  const clarify = requests().clarify;
  assert.equal(clarify?.requestId, 'srv-c');
  assert.equal(clarify?.toolId, 'call-1', 'the request wakes the row the stream drew, by its question');
  assert.equal(transcript().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'tool').length, 1, 'no second card');

  const sent = await controller.serverRequests.confirmClarify('s1', [
    { qid: 'q1', answer: 'Postgres' },
    { qid: 'q2', answer: null },
  ]);
  assert.equal(sent, true);
  assert.deepEqual(gateway.called('clarify.lock').map((c) => c.params), [
    { request_id: 'srv-c', question_id: 'q1', answer: 'Postgres', profile: 'default' },
    { request_id: 'srv-c', question_id: 'q2', answer: null, profile: 'default' },
  ]);
  assert.equal(requests().clarify, null);
  assert.equal(gateway.answerTo('srv-c'), undefined, 'the last lock resolves it server-side: no response frame is owed');
  assert.equal(requests().answered['call-1'].outcome, 'submitted');
  controller.dispose();
});

test('Skip answers the request with nothing and settles the row as skipped', async () => {
  const { gateway, controller, requests } = await running();
  toolStart(gateway);
  gateway.request('srv-c', 'clarify', clarifyParams());
  await flush();
  controller.serverRequests.skipClarify('s1');
  await flush();
  assert.deepEqual(gateway.answerTo('srv-c'), { jsonrpc: '2.0', id: 'srv-c', result: {} });
  assert.equal(requests().clarify, null);
  assert.equal(requests().answered['call-1'].outcome, 'cancelled');
  controller.dispose();
});

test('text sent while a clarify waits answers its first open question instead of steering', async () => {
  const { gateway, controller, requests } = await running();
  gateway.handlers['clarify.lock'] = () => ({ status: 'ok' });
  gateway.handlers['session.redirect'] = () => ({ status: 'redirected' });
  toolStart(gateway);
  gateway.request('srv-c', 'clarify', clarifyParams());
  await flush();

  await controller.send('sqlite');
  await flush();
  assert.deepEqual(gateway.called('clarify.lock')[0].params, { request_id: 'srv-c', question_id: 'q1', answer: 'SQLite', profile: 'default' });
  assert.deepEqual(requests().clarify?.lockedAnswers, { q1: 'SQLite' });

  await controller.send('because');
  await flush();
  assert.equal(gateway.called('clarify.lock')[1].params.question_id, 'q2');
  assert.equal(requests().clarify, null, 'the last answer closes the card');
  assert.equal(gateway.called('session.redirect').length, 0);
  controller.dispose();
});

test('a failed typed lock puts the card back as it was', async () => {
  const { gateway, controller, requests, snap } = await running();
  gateway.handlers['clarify.lock'] = () => {
    throw new Error('boom');
  };
  toolStart(gateway);
  gateway.request('srv-c', 'clarify', { ...clarifyParams(), questions: [{ qid: 'q1', question: 'Which database?' }] });
  await flush();
  await controller.send('sqlite');
  await flush();
  assert.equal(requests().clarify?.requestId, 'srv-c');
  assert.deepEqual(requests().clarify?.lockedAnswers, {});
  assert.deepEqual(requests().answered, {});
  assert.match(snap().notice?.text ?? '', /Could not send clarify response/);
  controller.dispose();
});

test('a withdrawn clarify settles its row, and the tool completing clears a stale request', async () => {
  const { gateway, controller, requests, transcript } = await running();
  toolStart(gateway);
  gateway.request('srv-c', 'clarify', clarifyParams());
  await flush();
  gateway.event('request.cancel', 'rt-1', { id: 'srv-c', method: 'clarify', reason: 'timeout' });
  await flush();
  assert.equal(requests().clarify, null);
  const part = transcript().messages.flatMap((m) => m.parts).find((p): p is ToolPart => p.kind === 'tool');
  assert.equal(part?.status, 'done');
  assert.match(part?.result ?? '', /"cancelled"/);

  gateway.request('srv-d', 'clarify', clarifyParams({ questions: [{ qid: 'q1', question: 'Another?' }] }));
  await flush();
  assert.equal(requests().clarify?.requestId, 'srv-d');
  gateway.event('tool.complete', 'rt-1', { tool_id: 'srv-d', name: 'clarify', result: { outcome: 'submitted', responses: [] } });
  await flush();
  assert.equal(requests().clarify, null);
  controller.dispose();
});

test('a clarify with no usable question is answered empty rather than parked', async () => {
  const { gateway, controller, requests } = await running();
  gateway.request('srv-c', 'clarify', { session_id: 'rt-1', questions: [] });
  await flush();
  assert.deepEqual(gateway.answerTo('srv-c'), { jsonrpc: '2.0', id: 'srv-c', result: {} });
  assert.equal(requests().clarify, null);
  controller.dispose();
});

test('a sudo prompt takes the sheet, answers its password and clears', async () => {
  const { gateway, controller, requests } = await running();
  gateway.request('srv-s', 'sudo', { session_id: 'rt-1', command: 'apt update' });
  await flush();
  const prompt = requests().prompts.sudo;
  assert.equal(prompt?.kind, 'sudo');

  assert.equal(controller.serverRequests.answerPrompt('s1', prompt!, 'hunter2'), null);
  assert.deepEqual(gateway.answerTo('srv-s'), { jsonrpc: '2.0', id: 'srv-s', result: { value: 'hunter2' } });
  assert.deepEqual(requests().prompts, {});
  controller.dispose();
});

test('offline, a prompt cannot take a value but can still be refused', async () => {
  const { gateway, controller, requests } = await running();
  gateway.request('srv-x', 'secret', { session_id: 'rt-1', env_var: 'API_KEY', prompt: 'Key?' });
  await flush();
  const prompt = requests().prompts.secret!;
  gateway.close();
  await flush();
  assert.match(controller.serverRequests.answerPrompt('s1', prompt, 's3cret') ?? '', /offline/);
  assert.equal(requests().prompts.secret?.requestId, 'srv-x');
  assert.equal(controller.serverRequests.answerPrompt('s1', prompt, ''), null);
  assert.deepEqual(requests().prompts, {});
  controller.dispose();
});

test('requests a resume re-delivers land in their chat, even before the runtime binds', async () => {
  const { gateway, controller, snap } = await setup();
  gateway.handlers['approval.pending'] = () => ({ approvals: [{ request_id: 'q7', command: 'ls' }] });
  gateway.handlers['approval.received'] = () => ({ acknowledged: true });
  gateway.handlers['session.resume'] = (p) => ({
    session_id: `rt-${p.session_id}`,
    message_count: 0,
    messages: [],
    info: {},
    running: true,
    open_requests: [
      { id: 'srv-r', method: 'approval', params: { session_id: `rt-${p.session_id}`, request_id: 'q7', command: 'ls' } },
      { id: 'srv-k', method: 'clarify', params: { session_id: `rt-${p.session_id}`, questions: [{ qid: 'q1', question: 'Which?' }] } },
    ],
  });
  controller.openSession({ id: 's9', title: 'Old' });
  await flush();

  const entry = snap().entries.s9;
  assert.equal(entry.requests.approvals[0].requestId, 'q7');
  assert.equal(entry.requests.approvals[0].serverRequestId, 'srv-r');
  assert.equal(entry.requests.clarify?.requestId, 'srv-k');
  const row = entry.transcript.messages.flatMap((m) => m.parts).find((p): p is ToolPart => p.kind === 'tool');
  assert.equal(row?.name, 'clarify', 'the history landed after the request, and the row was armed again');
  controller.dispose();
});

test('a clarify the resume snapshot omits ended while the phone was away', async () => {
  const { gateway, dialed, controller, requests } = await running();
  toolStart(gateway);
  gateway.request('srv-c', 'clarify', clarifyParams());
  await flush();
  assert.equal(requests().clarify?.requestId, 'srv-c');

  gateway.handlers['session.resume'] = () => ({ session_id: 'rt-1', message_count: 0, messages: [], info: {}, running: true, open_requests: [] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  gateway.close();
  await flush();
  controller.retryLink();
  await flush();
  assert.equal(dialed.length, 2, 'the link redialed');
  dialed[1].open();
  await flush();
  assert.equal(requests().clarify, null);
  controller.dispose();
});

test('methods the router does not own fall through to the channel’s own refusal', async () => {
  const { gateway, controller } = await running();
  gateway.request('srv-t', 'tour', { session_id: 'rt-1', action: 'stop' });
  await flush();
  assert.equal(gateway.answerTo('srv-t')?.error?.code, -32601);
  controller.dispose();
});
