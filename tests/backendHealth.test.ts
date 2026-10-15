import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  awaitRestart,
  connectionState,
  fetchReadiness,
  gatewayHealth,
  interpretReadiness,
  logTail,
  menuRows,
  parseGatewayStatus,
  platformRows,
  platformTone,
  prettyState,
  readinessDisplay,
  sharedProfiles,
  trimLogLine,
  type GatewayStatus,
  type Readiness,
} from '../src/chat/backendHealth.ts';
import type { LinkState } from '../src/gateway/link.ts';

const open: LinkState = { kind: 'open' };
const waiting: LinkState = { kind: 'waiting', attempt: 1, retryAt: 0, detail: 'The connection dropped.' };
const ready: Readiness = { checksDisagree: false, ready: true, reason: null, source: 'runtime_check' };
const notReady: Readiness = { checksDisagree: false, ready: false, reason: 'No provider.', source: 'setup_status' };
const status = (partial: Partial<GatewayStatus> = {}): GatewayStatus => ({ running: true, state: 'running', platforms: {}, sharedWith: null, ...partial });

test('a runtime check outranks the loose setup check and carries its reason', () => {
  assert.deepEqual(interpretReadiness({ setup: { provider_configured: false }, setupError: null, runtime: { ok: true }, runtimeError: null }), {
    checksDisagree: true,
    ready: true,
    reason: null,
    source: 'runtime_check',
  });
  const failed = interpretReadiness({ setup: { provider_configured: true }, setupError: null, runtime: { ok: false, error: 'Quota exhausted.' }, runtimeError: null });
  assert.equal(failed.ready, false);
  assert.equal(failed.checksDisagree, true);
  assert.equal(failed.reason, 'Quota exhausted. setup.status reports configured credentials, but runtime resolution still failed.');
});

test('setup status answers alone, and silence is a fallback that is not ready', () => {
  const setupOnly = interpretReadiness({ setup: { provider_configured: false }, setupError: null, runtime: null, runtimeError: 'timed out' });
  assert.deepEqual(setupOnly, { checksDisagree: false, ready: false, reason: 'timed out', source: 'setup_status' });
  const silent = interpretReadiness({ setup: null, setupError: null, runtime: null, runtimeError: null });
  assert.equal(silent.source, 'fallback');
  assert.equal(silent.ready, false);
  assert.match(silent.reason ?? '', /Add a provider credential/);
});

test('readiness reads as checking, ready, needs setup or unavailable', () => {
  assert.equal(readinessDisplay(null), 'checking');
  assert.equal(readinessDisplay(ready), 'ready');
  assert.equal(readinessDisplay(notReady), 'needs_setup');
  assert.equal(readinessDisplay({ ...notReady, checksDisagree: true }), 'unavailable');
});

test('both readiness legs go out for the profile and one failing does not sink the other', async () => {
  const asked: Array<[string, Record<string, unknown>]> = [];
  const result = await fetchReadiness(async (method, params) => {
    asked.push([method, params]);
    if (method === 'setup.runtime_check') throw new Error('request timed out');
    return { provider_configured: true };
  }, 'work');
  assert.deepEqual(asked.map(([method]) => method).sort(), ['setup.runtime_check', 'setup.status']);
  assert.ok(asked.every(([, params]) => params.profile === 'work'));
  assert.deepEqual(result, { checksDisagree: false, ready: true, reason: null, source: 'setup_status' });
});

test('the pill is quiet when ready and shows the desktop detail', () => {
  const health = gatewayHealth({ link: open, inference: ready, status: status(), restarting: false });
  assert.deepEqual([health.label, health.detail, health.tone, health.icon, health.ready], ['Backend', 'ready', 'default', 'pulse', true]);
  assert.equal(health.title, undefined);
});

test('an open link with inference unknown or missing is amber with the alert icon', () => {
  const checking = gatewayHealth({ link: open, inference: null, status: null, restarting: false });
  assert.deepEqual([checking.detail, checking.tone, checking.icon], ['checking', 'warn', 'alert']);
  const needsSetup = gatewayHealth({ link: open, inference: notReady, status: null, restarting: false });
  assert.deepEqual([needsSetup.detail, needsSetup.tone, needsSetup.title], ['needs setup', 'warn', 'No provider.']);
  const unavailable = gatewayHealth({ link: open, inference: { ...notReady, checksDisagree: true }, status: null, restarting: false });
  assert.equal(unavailable.detail, 'inference unavailable');
});

test('connecting is amber and a dropped link is destructive', () => {
  const connecting = gatewayHealth({ link: { kind: 'connecting' }, inference: null, status: null, restarting: false });
  assert.deepEqual([connecting.detail, connecting.tone], ['connecting', 'warn']);
  for (const link of [waiting, { kind: 'paused' } as LinkState, { kind: 'signed-out', detail: 'x' } as LinkState]) {
    const down = gatewayHealth({ link, inference: ready, status: null, restarting: false });
    assert.deepEqual([down.detail, down.tone, down.icon], ['offline', 'bad', 'alert']);
  }
});

test('restarting wins the detail, keeps the quiet tone and shows the spinner', () => {
  const health = gatewayHealth({ link: waiting, inference: null, status: null, restarting: true });
  assert.deepEqual([health.detail, health.tone, health.icon, health.restarting], ['restarting…', 'default', 'spinner', true]);
});

test('a messaging platform that is down degrades an open link even with inference ready', () => {
  const down = gatewayHealth({
    link: open,
    inference: ready,
    status: status({ platforms: { 'discord:main': { state: 'fatal' }, telegram: { state: 'connected' } } }),
    restarting: false,
  });
  assert.deepEqual([down.detail, down.degraded, down.ready, down.tone, down.title], ['main down', true, false, 'warn', 'main down']);
  const stopped = gatewayHealth({ link: open, inference: ready, status: status({ running: false, state: 'stopped' }), restarting: false });
  assert.equal(stopped.detail, 'messaging stopped');
  const ignored = gatewayHealth({ link: open, inference: ready, status: status({ platforms: { slack: { state: 'disabled' } } }), restarting: false });
  assert.equal(ignored.ready, true);
  const closed = gatewayHealth({ link: waiting, inference: ready, status: status({ running: false, state: 'stopped' }), restarting: false });
  assert.equal(closed.degraded, false);
});

test('the popover rows follow the connection and the readiness verdict', () => {
  assert.deepEqual(menuRows(open, ready), { connectionLabel: 'Connected', connectionTone: 'good', inferenceLabel: 'Inference ready', inferenceTone: 'good' });
  assert.deepEqual(menuRows(open, notReady), { connectionLabel: 'Connected', connectionTone: 'good', inferenceLabel: 'Inference not ready', inferenceTone: 'warn' });
  assert.deepEqual(menuRows(open, null), { connectionLabel: 'Connected', connectionTone: 'good', inferenceLabel: 'Checking inference', inferenceTone: 'warn' });
  assert.deepEqual(menuRows({ kind: 'connecting' }, ready), { connectionLabel: 'Connecting', connectionTone: 'warn', inferenceLabel: 'Disconnected', inferenceTone: 'bad' });
  assert.deepEqual(menuRows(waiting, ready), { connectionLabel: 'Closed', connectionTone: 'bad', inferenceLabel: 'Disconnected', inferenceTone: 'bad' });
});

test('link states map onto the desktop connection strings', () => {
  assert.deepEqual(
    [open, { kind: 'connecting' }, waiting, { kind: 'paused' }, { kind: 'unsupported', detail: '' }].map((link) => connectionState(link as LinkState)),
    ['open', 'connecting', 'closed', 'idle', 'error'],
  );
});

test('platforms sort by name and take the shared tone', () => {
  assert.equal(prettyState('startup_failed'), 'Startup failed');
  assert.deepEqual(
    [platformTone('connected'), platformTone('disabled'), platformTone('fatal'), platformTone('startup_failed'), platformTone('retrying'), platformTone(null)],
    ['good', 'muted', 'bad', 'bad', 'warn', 'warn'],
  );
  assert.deepEqual(platformRows(status({ platforms: { telegram: { state: 'connected' }, discord: { state: 'restart_needed' } } })), [
    { name: 'discord', label: 'Restart needed', tone: 'warn' },
    { name: 'telegram', label: 'Connected', tone: 'good' },
  ]);
  assert.deepEqual(platformRows(null), []);
});

test('the status body is read defensively', () => {
  assert.equal(parseGatewayStatus('nope'), null);
  assert.deepEqual(
    parseGatewayStatus({
      gateway_running: true,
      gateway_state: 'running',
      gateway_platforms: { telegram: { state: 'connected', updated_at: 'x' }, broken: 3 },
      gateway_shared_with: ['default', 'alpha'],
    }),
    { running: true, state: 'running', platforms: { telegram: { state: 'connected' } }, sharedWith: ['default', 'alpha'] },
  );
  assert.deepEqual(parseGatewayStatus({}), { running: undefined, state: null, platforms: {}, sharedWith: null });
});

test('a shared gateway names every profile it serves, default first; a lone one is not shared', () => {
  assert.deepEqual(sharedProfiles({ sharedWith: ['zed', 'default', 'alpha', 'alpha'] }), ['default', 'alpha', 'zed']);
  assert.equal(sharedProfiles({ sharedWith: ['default'] }), null);
  assert.equal(sharedProfiles({ sharedWith: null }), null);
  assert.equal(sharedProfiles(null), null);
});

test('log lines lose their timestamp and runtime prefixes', () => {
  assert.equal(trimLogLine('2026-10-15 09:12:31,402 [rt-ab12] INFO tui_gateway: session resumed'), 'INFO tui_gateway: session resumed');
  assert.equal(trimLogLine('  2026-10-15T09:12:31.402 WARNING x  '), 'WARNING x');
  assert.equal(trimLogLine('plain'), 'plain');
});

test('the log tail drops socket churn and blanks, keeps the newest lines and trims them', () => {
  const lines = [
    '2026-10-15 09:00:00,001 INFO uvicorn: ws accepted',
    '',
    '2026-10-15 09:00:01,001 INFO uvicorn: WS closed 1001',
    '2026-10-15 09:00:02,001 INFO tui_gateway: first',
    '2026-10-15 09:00:03,001 INFO ws ping sent',
    '[rt-1] second',
    '2026-10-15 09:00:04,001 INFO tui_gateway: third',
  ];
  assert.deepEqual(logTail(lines), ['INFO tui_gateway: first', 'second', 'INFO tui_gateway: third']);
  assert.deepEqual(logTail(lines, 2), ['second', 'INFO tui_gateway: third']);
});

const instant = () => Promise.resolve();

test('a restart that finishes cleanly resolves, and a recorded failure throws', async () => {
  const answers = [{ running: true, exit_code: null }, { running: false, exit_code: null }, { running: false, exit_code: 0 }];
  let calls = 0;
  await awaitRestart(async () => answers[calls++]!, instant);
  assert.equal(calls, 3);
  await assert.rejects(() => awaitRestart(async () => ({ running: false, exit_code: 1 }), instant), /Gateway restart failed\./);
});

test('refusals mid-restart are tolerated; a window refused end to end is a failure', async () => {
  let calls = 0;
  await awaitRestart(async () => {
    calls += 1;
    if (calls < 4) throw new Error('connection refused');
    return { running: false, exit_code: 0 };
  }, instant);
  assert.equal(calls, 4);
  await assert.rejects(() => awaitRestart(async () => Promise.reject(new Error('connection refused')), instant), /connection refused/);
});

test('a restart still running when the window closes counts as success', async () => {
  let calls = 0;
  await awaitRestart(async () => {
    calls += 1;
    return { running: true, exit_code: null };
  }, instant);
  assert.equal(calls, 18);
});
