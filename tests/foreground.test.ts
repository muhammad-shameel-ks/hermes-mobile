import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ForegroundAbortedError, waitForForeground, type AppStateSource } from '../src/auth/foreground.ts';

function fakeAppState(initial: string) {
  const listeners = new Set<(state: string) => void>();
  const source: AppStateSource = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const emit = (state: string) => {
    source.currentState = state;
    for (const listener of [...listeners]) listener(state);
  };
  return { source, emit, listeners };
}

test('resolves at once when the app is already active', async () => {
  const { source, listeners } = fakeAppState('active');
  await waitForForeground(source);
  assert.equal(listeners.size, 0);
});

test('waits for the app to become active, ignoring other transitions', async () => {
  const { source, emit, listeners } = fakeAppState('background');
  let settled = false;
  const waiting = waitForForeground(source).then(() => {
    settled = true;
  });
  emit('inactive');
  await Promise.resolve();
  assert.equal(settled, false);
  emit('active');
  await waiting;
  assert.equal(settled, true);
  assert.equal(listeners.size, 0);
});

test('rejects and unsubscribes when aborted', async () => {
  const { source, listeners } = fakeAppState('background');
  const controller = new AbortController();
  const waiting = waitForForeground(source, controller.signal);
  controller.abort();
  await assert.rejects(waiting, ForegroundAbortedError);
  assert.equal(listeners.size, 0);
});

test('rejects when the signal is already aborted', async () => {
  const { source } = fakeAppState('background');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForForeground(source, controller.signal), ForegroundAbortedError);
});
