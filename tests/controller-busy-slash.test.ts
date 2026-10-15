import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUSY_KICKOFF_TEXT } from '../src/chat/slashRun.ts';
import { flush, rig } from './support/gateway.ts';

const text = (message: { parts: Array<{ kind: string; text?: string }> } | undefined) => (message?.parts ?? []).map((p) => (p.kind === 'text' ? p.text : '')).join('');

/** a session open and mid-turn */
async function running() {
  const made = await rig(() => ({ messages: [] }));
  made.controller.openSession({ id: 's1', title: 'chat' });
  await flush();
  made.gateway.event('message.start', 'rt-s1');
  await flush();
  assert.equal(made.snap().entries.s1.transcript.running, true);
  return { ...made, entry: () => made.snap().entries.s1 };
}

const endTurn = async (gateway: Awaited<ReturnType<typeof running>>['gateway']) => {
  gateway.event('message.complete', 'rt-s1', { status: 'complete', text: 'done' });
  await flush();
};

test('a command typed mid-turn runs now: it is neither steered nor queued', async () => {
  const { gateway, controller, entry } = await running();
  gateway.handlers['session.status'] = () => ({ output: 'busy: yes' });
  await controller.send('/status');
  await flush();
  assert.equal(gateway.calls.filter((c) => c.method === 'session.status').length, 1);
  assert.equal(gateway.calls.filter((c) => c.method === 'session.redirect' || c.method === 'prompt.submit').length, 0);
  assert.equal(entry().stack.queue.entries.length, 0);
  assert.equal(text(entry().transcript.messages.at(-1)), '/status\nbusy: yes');
  assert.equal(entry().transcript.running, true, 'the live turn is untouched');
  controller.dispose();
});

test('/stop mid-turn interrupts the turn', async () => {
  const { gateway, controller } = await running();
  gateway.handlers['session.interrupt'] = () => ({ status: 'interrupted' });
  await controller.send('/stop');
  await flush();
  assert.equal(gateway.calls.filter((c) => c.method === 'session.interrupt').length, 1);
  controller.dispose();
});

test('a skill command mid-turn queues its kickoff, and the drain sends it with the invocation as the bubble', async () => {
  const { gateway, controller, entry } = await running();
  gateway.handlers['slash.exec'] = () => ({ type: 'skill', name: 'work', message: '[skill body]', display: '/work fix it' });
  gateway.handlers['prompt.submit'] = () => ({ status: 'streaming' });
  await controller.send('/work fix it');
  await flush();
  assert.equal(gateway.calls.filter((c) => c.method === 'prompt.submit').length, 0);
  assert.deepEqual(entry().stack.queue.entries.map((e) => ({ text: e.text, displayText: e.displayText })), [{ text: '[skill body]', displayText: '/work fix it' }]);
  assert.match(text(entry().transcript.messages.at(-1)), new RegExp(BUSY_KICKOFF_TEXT.queued));

  await endTurn(gateway);
  const submits = gateway.calls.filter((c) => c.method === 'prompt.submit');
  assert.equal(submits.length, 1);
  assert.equal(submits[0].params.text, '[skill body]');
  assert.equal(entry().stack.queue.entries.length, 0);
  const users = entry().transcript.messages.filter((m) => m.role === 'user');
  assert.deepEqual(users.map(text), ['/work fix it']);
  controller.dispose();
});

test('a command parked with the Queue control runs when its turn ends, never as prompt text', async () => {
  const { gateway, controller, entry } = await running();
  gateway.handlers['session.status'] = () => ({ output: 'idle now' });
  controller.queueMessage('/status');
  await flush();
  assert.deepEqual(entry().stack.queue.entries.map((e) => e.text), ['/status']);
  assert.equal(gateway.calls.filter((c) => c.method === 'session.status').length, 0, 'it waits for its turn');

  await endTurn(gateway);
  assert.equal(gateway.calls.filter((c) => c.method === 'session.status').length, 1);
  assert.equal(gateway.calls.filter((c) => c.method === 'prompt.submit').length, 0);
  assert.equal(entry().stack.queue.entries.length, 0);
  assert.ok(entry().transcript.messages.some((m) => text(m) === '/status\nidle now'));
  controller.dispose();
});

test('/compress mid-turn is refused by the gateway without ending the live turn\'s running state', async () => {
  const { gateway, controller, entry } = await running();
  gateway.handlers['session.compress'] = () => {
    throw new Error('session busy');
  };
  await controller.send('/compress');
  await flush();
  assert.match(text(entry().transcript.messages.at(-1)), /Compacting failed: .*session busy/);
  assert.equal(entry().transcript.running, true);
  controller.dispose();
});
