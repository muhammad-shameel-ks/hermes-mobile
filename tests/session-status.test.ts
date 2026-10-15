import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chatActivity, hasLiveTurn, nextFinishedAway, resolveDotState, type Activity } from '../src/drawer/sessionStatus.ts';

const idle: Activity = { running: false, needsInput: false, background: false };

test('a blocking prompt outranks a running turn, which outranks background work, unread and draft', () => {
  assert.equal(resolveDotState({ activity: { running: true, needsInput: true, background: true }, unread: true }), 'needs-input');
  assert.equal(resolveDotState({ activity: { ...idle, running: true, background: true }, unread: true }), 'working');
  assert.equal(resolveDotState({ activity: { ...idle, background: true }, unread: true }), 'background');
  assert.equal(resolveDotState({ activity: idle, unread: true, draft: true }), 'unread');
  assert.equal(resolveDotState({ activity: idle, draft: true }), 'draft');
  assert.equal(resolveDotState({ activity: idle }), 'idle');
});

test('a live turn is a working one or one waiting on an answer', () => {
  assert.ok(hasLiveTurn('working') && hasLiveTurn('needs-input'));
  assert.ok(!hasLiveTurn('background') && !hasLiveTurn('unread') && !hasLiveTurn('idle'));
});

test('a chat that is not loaded is idle', () => {
  assert.deepEqual(chatActivity(undefined), idle);
});

test('requests, background processes and subagents read off a live chat', () => {
  const entry = (patch: { approvals?: unknown[]; clarify?: unknown; prompts?: object; background?: unknown[]; subagents?: unknown[]; running?: boolean }) =>
    ({
      transcript: { running: patch.running ?? false },
      requests: { approvals: patch.approvals ?? [], clarify: patch.clarify ?? null, prompts: patch.prompts ?? {} },
      stack: { status: { background: patch.background ?? [], subagents: patch.subagents ?? [] } },
    }) as never;
  assert.equal(chatActivity(entry({ running: true })).running, true);
  assert.equal(chatActivity(entry({ approvals: [{}] })).needsInput, true);
  assert.equal(chatActivity(entry({ prompts: { sudo: {} } })).needsInput, true);
  assert.equal(chatActivity(entry({ background: [{ state: 'done' }] })).background, false);
  assert.equal(chatActivity(entry({ background: [{ state: 'running' }] })).background, true);
  assert.equal(chatActivity(entry({ subagents: [{ status: 'queued' }] })).background, true);
  assert.equal(chatActivity(entry({ subagents: [{ status: 'completed' }] })).background, false);
});

test('a turn that ends in a chat the reader is not looking at is marked until they open it', () => {
  const running = { a: { transcript: { running: true } }, b: { transcript: { running: true } } };
  const settled = { a: { transcript: { running: false } }, b: { transcript: { running: false } } };
  const marks = nextFinishedAway({}, running, settled, 'b');
  assert.deepEqual(marks, { a: true });
  assert.equal(nextFinishedAway(marks, settled, settled, 'b'), marks, 'nothing changed keeps the object');
  assert.deepEqual(nextFinishedAway(marks, settled, settled, 'a'), {}, 'opening reads it');
});
