import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyStatusResponse, probeGateway } from '../src/gateway/status.ts';

const gatewayStatus = JSON.stringify({
  version: '0.21.6',
  auth_required: true,
  auth_providers: ['basic'],
  auth_flows: ['cookie', 'native_pkce'],
  gateway_mode: 'multiplex',
  profiles: ['default'],
});

test('a gated gateway that advertises native_pkce is ready to sign in', () => {
  const result = classifyStatusResponse(200, gatewayStatus);
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.status.version, '0.21.6');
  assert.equal(result.status.authRequired, true);
  assert.deepEqual(result.status.authFlows, ['cookie', 'native_pkce']);
  assert.deepEqual(result.status.authProviders, ['basic']);
});

test('a gateway with other flows is unsupported, not a password form', () => {
  const result = classifyStatusResponse(200, JSON.stringify({ version: '1.0.0', auth_required: true, auth_flows: ['cookie'] }));
  assert.equal(result.kind, 'unsupported');
});

test('an ungated gateway has nothing to sign in to', () => {
  const result = classifyStatusResponse(200, JSON.stringify({ version: '1.0.0', auth_required: false, auth_flows: [] }));
  assert.equal(result.kind, 'no-auth-gate');
});

test('a non-JSON or versionless answer is not a Hermes gateway', () => {
  assert.equal(classifyStatusResponse(200, '<html>hi</html>').kind, 'not-hermes');
  assert.equal(classifyStatusResponse(200, JSON.stringify({ ok: true })).kind, 'not-hermes');
});

test('a non-2xx answer is an http error carrying the status', () => {
  const result = classifyStatusResponse(502, 'bad gateway');
  assert.equal(result.kind, 'http-error');
  if (result.kind !== 'http-error') return;
  assert.equal(result.httpStatus, 502);
});

test('a network failure is unreachable', async () => {
  const failing: typeof fetch = async () => {
    throw new TypeError('Network request failed');
  };
  const result = await probeGateway('http://127.0.0.1:9119', { fetchImpl: failing });
  assert.equal(result.kind, 'unreachable');
});

test('a silent gateway turns into a timeout', async () => {
  const hanging: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const result = await probeGateway('http://127.0.0.1:9119', { fetchImpl: hanging, timeoutMs: 20 });
  assert.equal(result.kind, 'timeout');
});

test('an answered probe is classified from its body', async () => {
  const answering: typeof fetch = async () => new Response(gatewayStatus, { status: 200 });
  const result = await probeGateway('http://127.0.0.1:9119', { fetchImpl: answering });
  assert.equal(result.kind, 'ok');
});
