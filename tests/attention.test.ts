import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AttentionCenter } from '../src/attention/center.ts';
import { flush, rig } from './support/gateway.ts';

const approval = (sessionId: string, requestId: string, command: string) => ({ session_id: sessionId, request_id: requestId, command, description: 'dangerous command' });

/** two held chats: "Build fix" (s1) mid-turn off screen, "Docs" (s2) open */
async function twoChats({ granted = true }: { granted?: boolean } = {}) {
  const harness = await rig(() => ({ messages: [] }));
  const { gateway, controller } = harness;
  gateway.handlers['approval.pending'] = () => ({ approvals: [] });
  controller.openSession({ id: 's1', title: 'Build fix' });
  await flush();
  controller.openSession({ id: 's2', title: 'Docs' });
  await flush();
  gateway.event('message.start', 'rt-s1');
  await flush();

  const posted: string[] = [];
  const dismissed: string[] = [];
  const holds: string[] = [];
  const app: string[] = [];
  const center = new AttentionCenter({
    source: controller,
    notifier: { post: (item) => posted.push(item.id), dismiss: (id) => dismissed.push(id) },
    hold: {
      start: (_title, text) => {
        holds.push(text);
        return granted;
      },
      stop: () => app.push('stop'),
    },
    app: { pause: () => app.push('pause'), resume: () => app.push('resume'), flush: () => app.push('flush') },
    active: true,
  });
  center.start();
  const items = () => center.getItems().map((item) => ({ chat: item.chat, headline: item.headline, detail: item.detail }));
  return { ...harness, center, items, posted, dismissed, holds, app };
}

test('a request in a chat off screen rides the banner; the open chat shows its own as a card', async () => {
  const { gateway, controller, items } = await twoChats();
  gateway.request('srv-1', 'approval', approval('rt-s1', 'q1', 'rm -rf build'));
  gateway.request('srv-2', 'sudo', { session_id: 'rt-s2', command: 'apt install jq' });
  await flush();
  assert.deepEqual(items(), [{ chat: 'Build fix', headline: 'Approval needed', detail: 'rm -rf build' }]);

  controller.openSession({ id: 's1', title: 'Build fix' });
  await flush();
  assert.deepEqual(items(), [{ chat: 'Docs', headline: 'Password needed', detail: 'apt install jq' }], 'switching chats swaps which request is away');
  controller.dispose();
});

test('Run from the banner answers the approval in its own chat and takes the banner down', async () => {
  const { gateway, controller, center, items } = await twoChats();
  gateway.request('srv-1', 'approval', approval('rt-s1', 'q1', 'rm -rf build'));
  await flush();
  const [item] = center.getItems();
  assert.equal(await controller.serverRequests.answerApproval(item.key, item.approval?.requestId, 'once'), true);
  await flush();
  assert.deepEqual(gateway.answers, [{ id: 'srv-1', result: { choice: 'once' } }]);
  assert.deepEqual(items(), []);
  assert.equal(controller.getSnapshot().openKey, 's2', 'answering from the banner leaves the reader where they are');
  controller.dispose();
});

test('dismissing waves off one request; the next one in that chat comes down again', async () => {
  const { gateway, controller, center, items } = await twoChats();
  gateway.request('srv-1', 'approval', approval('rt-s1', 'q1', 'rm -rf build'));
  gateway.request('srv-2', 'approval', approval('rt-s1', 'q2', 'git push --force'));
  await flush();
  center.dismiss(center.getItems()[0].id);
  assert.deepEqual(items(), []);
  // the server still holds the second approval when the phone asks after answering the first
  gateway.handlers['approval.pending'] = () => ({ approvals: [approval('rt-s1', 'q2', 'git push --force')] });

  await controller.serverRequests.answerApproval('s1', 'q1', 'deny');
  await flush();
  assert.deepEqual(items(), [{ chat: 'Build fix', headline: 'Approval needed', detail: 'git push --force' }]);
  controller.dispose();
});

test('while away every open request is a system notification, taken down when it closes or the app returns', async () => {
  const { gateway, controller, center, posted, dismissed } = await twoChats();
  gateway.request('srv-1', 'approval', approval('rt-s1', 'q1', 'rm -rf build'));
  await flush();
  assert.deepEqual(posted, [], 'the banner speaks while the app is open');

  center.background();
  assert.deepEqual(posted, ['s1:approval:q1'], 'what was already waiting is what the reader walked away from');

  gateway.request('srv-2', 'sudo', { session_id: 'rt-s2', command: 'apt install jq' });
  await flush();
  assert.deepEqual(posted, ['s1:approval:q1', 's2:prompt:srv-2'], 'the open chat is out of sight too');

  gateway.event('request.cancel', 'rt-s2', { id: 'srv-2' });
  await flush();
  assert.deepEqual(dismissed, ['s2:prompt:srv-2']);

  center.foreground();
  assert.deepEqual(dismissed, ['s2:prompt:srv-2', 's1:approval:q1']);
  gateway.request('srv-3', 'approval', approval('rt-s1', 'q3', 'make deploy'));
  await flush();
  assert.equal(posted.length, 2, 'nothing is posted once the app is back');
  controller.dispose();
});

test('a live turn holds the socket open in the background until nothing is left to wait for', async () => {
  const { gateway, controller, center, holds, app } = await twoChats();
  center.background();
  assert.deepEqual(holds, ['Working in 1 chat']);
  assert.deepEqual(app, ['flush'], 'held: saved, not closed');

  gateway.request('srv-1', 'approval', approval('rt-s1', 'q1', 'rm -rf build'));
  await flush();
  assert.deepEqual(holds, ['Working in 1 chat', 'Waiting for your answer in 1 chat']);

  await controller.serverRequests.answerApproval('s1', 'q1', 'once');
  gateway.event('message.complete', 'rt-s1', { text: 'done' });
  await flush();
  assert.deepEqual(app, ['flush', 'stop', 'pause']);

  center.foreground();
  assert.deepEqual(app, ['flush', 'stop', 'pause', 'resume'], 'a released hold is not stopped twice');
  controller.dispose();
});

test('with nothing live, or a hold the system refuses, the socket closes as the app leaves', async () => {
  const idle = await twoChats();
  idle.gateway.event('message.complete', 'rt-s1', { text: 'done' });
  await flush();
  idle.center.background();
  assert.deepEqual(idle.holds, []);
  assert.deepEqual(idle.app, ['pause']);
  idle.controller.dispose();

  const refused = await twoChats({ granted: false });
  refused.center.background();
  assert.deepEqual(refused.holds, ['Working in 1 chat']);
  assert.deepEqual(refused.app, ['pause']);
  refused.center.foreground();
  assert.deepEqual(refused.app, ['pause', 'resume'], 'a hold that never started is not stopped');
  refused.controller.dispose();
});
