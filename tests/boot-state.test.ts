import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bootFailureCopy, BOOT_CAUSES, classifyBootFailure, probeFailure, restoreSession, type RestoreDeps } from '../src/app/boot-state.ts';
import type { Credentials } from '../src/auth/tokens.ts';
import type { GatewayProbe } from '../src/gateway/status.ts';

const connection = { id: 'c1', label: 'home', baseUrl: 'https://hermes.example.com', authMode: 'oauth' as const };
const credentials: Credentials = { accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresAt: 100, provider: 'p', userId: 'u' };
const status = { version: '1.0.0', authRequired: true, authFlows: ['native_pkce'], authProviders: [] };

function deps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    loadConnection: async () => connection,
    loadCredentials: async () => credentials,
    saveCredentials: async () => undefined,
    refreshCredentials: async () => ({ kind: 'refreshed', credentials }),
    probeGateway: async () => ({ kind: 'ok', status }),
    isStale: () => false,
    nowSeconds: () => 0,
    ...overrides,
  };
}

test('failures are classified into one plain sentence with the raw text kept aside', () => {
  assert.equal(classifyBootFailure('Network request failed'), 'unreachable');
  assert.equal(classifyBootFailure('https://x did not answer within 8s'), 'timedOut');
  assert.equal(classifyBootFailure('java.security.cert.CertPathValidatorException: Trust anchor for certification path not found'), 'secureConnection');
  assert.equal(classifyBootFailure('something odd'), null);
  assert.equal(classifyBootFailure(''), null);

  assert.deepEqual(bootFailureCopy('Network request failed'), { headline: BOOT_CAUSES.unreachable, rawDetail: 'Network request failed' });
  assert.deepEqual(bootFailureCopy('odd\nsecond line'), { headline: 'odd', rawDetail: 'odd\nsecond line' });
  assert.deepEqual(bootFailureCopy('odd'), { headline: 'odd', rawDetail: null });
});

test('each probe outcome reads as a headline', () => {
  const failures: Array<Exclude<GatewayProbe, { kind: 'ok' }>> = [
    { kind: 'timeout' },
    { kind: 'unreachable', detail: 'Network request failed' },
    { kind: 'http-error', httpStatus: 502, detail: 'bad gateway' },
    { kind: 'not-hermes', httpStatus: 200, detail: 'the answer was not JSON' },
    { kind: 'no-auth-gate', status: { ...status, authRequired: false, authFlows: [] } },
    { kind: 'unsupported', status: { ...status, authFlows: ['cookie'] } },
  ];
  assert.deepEqual(
    failures.map((probe) => probeFailure(probe).headline),
    [
      BOOT_CAUSES.timedOut,
      BOOT_CAUSES.unreachable,
      'The gateway answered 502.',
      'No Hermes gateway answered at this address.',
      'This gateway no longer has a sign-in gate.',
      'This gateway does not offer native PKCE sign-in.',
    ],
  );
  assert.equal(probeFailure({ kind: 'unsupported', status: { ...status, authFlows: ['cookie'] } }).detail, 'auth_flows: cookie');
});

test('a cold start with nothing saved is onboarding', async () => {
  const state = await restoreSession(deps({ loadConnection: async () => null }));
  assert.deepEqual(state, { kind: 'connect', connection: null, address: '', notice: null });
});

test('a saved gateway without a credential is signed out', async () => {
  const state = await restoreSession(deps({ loadCredentials: async () => null }));
  assert.deepEqual(state, { kind: 'signed-out', connection });
});

test('a fresh credential and an answering gateway sign in', async () => {
  const state = await restoreSession(deps());
  assert.equal(state.kind, 'signed-in');
});

test('a stale credential is refreshed once and persisted', async () => {
  const saved: Credentials[] = [];
  const next = { ...credentials, accessToken: 'b' };
  const state = await restoreSession(
    deps({
      isStale: () => true,
      refreshCredentials: async () => ({ kind: 'refreshed', credentials: next }),
      saveCredentials: async (_id, value) => {
        saved.push(value);
      },
    }),
  );
  assert.deepEqual(saved, [next]);
  assert.equal(state.kind === 'signed-in' && state.credentials.accessToken, 'b');
});

test('a rejected refresh needs a fresh sign-in', async () => {
  const state = await restoreSession(deps({ isStale: () => true, refreshCredentials: async () => ({ kind: 'expired' }) }));
  assert.deepEqual(state, { kind: 'reauth', connection, reason: 'The session needs a fresh sign-in.' });
});

test('a provider outage or a dead network is a failure to retry, not a sign-out', async () => {
  const outage = await restoreSession(deps({ isStale: () => true, refreshCredentials: async () => ({ kind: 'unavailable' }) }));
  assert.equal(outage.kind, 'unreachable');
  const offline = await restoreSession(deps({ isStale: () => true, refreshCredentials: async () => ({ kind: 'failed', detail: 'Network request failed' }) }));
  assert.equal(offline.kind === 'unreachable' && offline.headline, BOOT_CAUSES.unreachable);
});

test('an unanswering gateway is unreachable', async () => {
  const state = await restoreSession(deps({ probeGateway: async () => ({ kind: 'timeout' }) }));
  assert.deepEqual(state, { kind: 'unreachable', connection, headline: BOOT_CAUSES.timedOut, detail: null });
});

test('a storage failure falls back to onboarding', async () => {
  const state = await restoreSession(
    deps({
      loadConnection: async () => {
        throw new Error('keystore');
      },
    }),
  );
  assert.equal(state.kind, 'connect');
});
