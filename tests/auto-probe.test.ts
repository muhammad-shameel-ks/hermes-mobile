import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAutoProbe, type AutoProbeState } from '../src/gateway/auto-probe.ts';
import type { GatewayProbe } from '../src/gateway/status.ts';

const ready: GatewayProbe = {
  kind: 'ok',
  status: { version: '0.21.6', authRequired: true, authFlows: ['native_pkce'], authProviders: [] },
};

type Call = { baseUrl: string; signal: AbortSignal; settle: (probe: GatewayProbe) => void };

function harness(pauseMs = 100) {
  const calls: Call[] = [];
  const states: AutoProbeState[] = [];
  const auto = createAutoProbe({
    pauseMs,
    onChange: (state) => states.push(state),
    probe: (baseUrl, signal) =>
      new Promise<GatewayProbe>((resolve) => {
        calls.push({ baseUrl, signal, settle: resolve });
      }),
  });
  const last = () => states[states.length - 1];
  return { auto, calls, states, last };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('waits for a pause in typing, then probes the parsed base URL', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { auto, calls, last } = harness();

  auto.input('127.0.0.1');
  auto.input('127.0.0.1:91');
  auto.input('127.0.0.1:9119');
  assert.equal(last().kind, 'pending');
  assert.equal(calls.length, 0);

  t.mock.timers.tick(100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].baseUrl, 'http://127.0.0.1:9119');
  assert.equal(last().kind, 'probing');

  calls[0].settle(ready);
  await flush();
  const state = last();
  assert.equal(state.kind, 'probed');
  if (state.kind === 'probed') assert.equal(state.probe.kind, 'ok');
});

test('an edit withdraws a ready verdict at once and aborts the probe in flight', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { auto, calls, states, last } = harness();

  auto.input('10.0.0.5', { immediate: true });
  calls[0].settle(ready);
  await flush();
  assert.equal(last().kind, 'probed');

  auto.input('10.0.0.6', { immediate: true });
  auto.input('10.0.0.7');
  assert.equal(last().kind, 'pending');
  assert.equal(calls[1].signal.aborted, true);

  calls[1].settle(ready);
  await flush();
  assert.equal(last().kind, 'pending', 'a stale result must not land');

  t.mock.timers.tick(100);
  assert.equal(calls[2].baseUrl, 'http://10.0.0.7:9119');
  assert.ok(states.every((state) => state.kind !== 'probed' || state.address.host !== '10.0.0.6'));
});

test('an edit that resolves to the same base URL keeps the verdict', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { auto, calls, last } = harness();

  auto.input('localhost', { immediate: true });
  calls[0].settle(ready);
  await flush();

  auto.input('localhost/');
  auto.input('http://localhost:9119');
  assert.equal(last().kind, 'probed');
  assert.equal(calls.length, 1);
});

test('a malformed address is reported only after the pause', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { auto, calls, last } = harness();

  auto.input('http://gateway.example.com/api');
  assert.equal(last().kind, 'pending');
  t.mock.timers.tick(100);
  const state = last();
  assert.equal(state.kind, 'invalid');
  if (state.kind === 'invalid') assert.match(state.reason, /without a path/);
  assert.equal(calls.length, 0);
});

test('clearing the field returns to idle and cancels everything', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { auto, calls, last } = harness();

  auto.input('gateway.example.com');
  auto.input('  ');
  assert.equal(last().kind, 'idle');
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 0);
});

test('retry probes the same address again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { auto, calls, last } = harness();

  auto.input('192.168.1.4', { immediate: true });
  calls[0].settle({ kind: 'unreachable', detail: 'Network request failed' });
  await flush();
  assert.equal(last().kind, 'probed');

  auto.retry();
  assert.equal(last().kind, 'probing');
  assert.equal(calls[1].baseUrl, 'http://192.168.1.4:9119');
});

test('a throwing probe is reported as unreachable, and nothing lands after dispose', async () => {
  const states: AutoProbeState[] = [];
  let reject!: (error: Error) => void;
  const auto = createAutoProbe({
    onChange: (state) => states.push(state),
    probe: () =>
      new Promise<GatewayProbe>((_resolve, fail) => {
        reject = fail;
      }),
  });
  auto.input('127.0.0.1', { immediate: true });
  reject(new Error('boom'));
  await flush();
  const state = states[states.length - 1];
  assert.equal(state.kind, 'probed');
  if (state.kind === 'probed') assert.deepEqual(state.probe, { kind: 'unreachable', detail: 'boom' });

  auto.input('127.0.0.2', { immediate: true });
  auto.dispose();
  const count = states.length;
  reject(new Error('late'));
  await flush();
  assert.equal(states.length, count);
});

test('a caller abort is not reported as a timeout', async () => {
  const { probeGateway } = await import('../src/gateway/status.ts');
  const controller = new AbortController();
  const hanging: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const pending = probeGateway('http://127.0.0.1:9119', { fetchImpl: hanging, signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  assert.equal((await pending).kind, 'unreachable');
});

