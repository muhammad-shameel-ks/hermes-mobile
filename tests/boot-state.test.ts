import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KEYSTORE_FAILURE, restoreSession, type RestoreDeps } from '../src/app/boot-state.ts';
import type { Credentials } from '../src/auth/tokens.ts';

const connection = { id: 'c1', label: 'home', baseUrl: 'https://hermes.example.com', authMode: 'oauth' as const };
const credentials: Credentials = { accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresAt: 100, provider: 'p', userId: 'u' };

function deps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    loadConnection: async () => connection,
    loadCredentials: async () => credentials,
    ...overrides,
  };
}

test('a cold start with nothing saved is onboarding', async () => {
  const state = await restoreSession(deps({ loadConnection: async () => null }));
  assert.deepEqual(state, { kind: 'connect', connection: null, address: '', notice: null });
});

test('a saved gateway without a credential is signed out', async () => {
  const state = await restoreSession(deps({ loadCredentials: async () => null }));
  assert.deepEqual(state, { kind: 'signed-out', connection });
});

test('a saved sign-in mounts the app without touching the network', async () => {
  let calls = 0;
  const state = await restoreSession(
    deps({
      loadCredentials: async () => {
        calls += 1;
        return credentials;
      },
    }),
  );
  assert.equal(calls, 1);
  // the shell mounts on the stored credentials alone; a stale bearer is refreshed by the signed-in stack,
  // which also routes an expired session to reauth and leaves a down gateway to the chat's banner
  assert.equal(state.kind, 'signed-in');
  assert.equal(state.kind === 'signed-in' && state.status, null);
});

test('an unreadable keystore keeps the saved gateway instead of dropping to onboarding', async () => {
  const state = await restoreSession(
    deps({
      loadCredentials: async () => {
        throw new Error('keystore');
      },
    }),
  );
  assert.deepEqual(state, { kind: 'unreachable', connection, headline: KEYSTORE_FAILURE, detail: null });
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
