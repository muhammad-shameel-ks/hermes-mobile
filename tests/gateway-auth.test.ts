import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RefreshResult } from '../src/auth/native-flow.ts';
import { createAuthSession, ReauthRequiredError, type AuthSessionOptions } from '../src/auth/session.ts';
import type { Credentials } from '../src/auth/tokens.ts';
import { ApiError, buildQuery, createGatewayApi } from '../src/gateway/api.ts';

const creds = (accessToken: string, expiresAt = 10_000): Credentials => ({
  accessToken,
  refreshToken: `refresh-${accessToken}`,
  tokenType: 'Bearer',
  expiresAt,
  provider: 'basic',
  userId: 'admin',
});

function session(overrides: Partial<AuthSessionOptions> = {}) {
  const persisted: Credentials[] = [];
  const reauth: string[] = [];
  let refreshes = 0;
  const auth = createAuthSession({
    baseUrl: 'https://gw.example:443',
    credentials: creds('a1'),
    now: () => 1000,
    refresh: async (): Promise<RefreshResult> => {
      refreshes += 1;
      return { kind: 'refreshed', credentials: creds(`a${refreshes + 1}`) };
    },
    persist: async (c) => {
      persisted.push(c);
    },
    onReauthRequired: (reason) => reauth.push(reason),
    ...overrides,
  });
  return { auth, persisted, reauth, refreshCount: () => refreshes };
}

test('a fresh bearer is used as is; a stale one is refreshed once and persisted', async () => {
  const fresh = session();
  assert.equal(await fresh.auth.accessToken(), 'a1');
  assert.equal(fresh.refreshCount(), 0);

  const stale = session({ credentials: creds('a1', 1030) });
  const [x, y] = await Promise.all([stale.auth.accessToken(), stale.auth.accessToken()]);
  assert.equal(x, 'a2');
  assert.equal(y, 'a2');
  assert.equal(stale.refreshCount(), 1, 'concurrent callers share one refresh');
  assert.equal(stale.persisted.length, 1);
});

test('an expired refresh asks for sign-in exactly once', async () => {
  const s = session({ refresh: async () => ({ kind: 'expired' }) });
  await assert.rejects(s.auth.refreshNow(), ReauthRequiredError);
  await assert.rejects(s.auth.accessToken(), ReauthRequiredError);
  assert.equal(s.reauth.length, 1);
});

test('a provider outage is transient, not a sign-out', async () => {
  const s = session({ refresh: async () => ({ kind: 'unavailable' }) });
  await assert.rejects(s.auth.refreshNow(), /sign-in provider/);
  assert.equal(s.reauth.length, 0);
});

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const seen: Array<{ url: string; auth: string | null; method: string }> = [];
  const impl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(input), auth: headers.get('Authorization'), method: init?.method ?? 'GET' });
    const next = responses.shift() ?? { status: 500, body: 'no more responses' };
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status });
  };
  return { impl, seen };
}

test('REST calls carry the bearer and the query', async () => {
  const { auth } = session();
  const { impl, seen } = fakeFetch([{ status: 200, body: { ok: true } }]);
  const api = createGatewayApi(auth, impl);
  assert.deepEqual(await api.get('/api/profiles', { profile: 'bot one', empty: '' }), { ok: true });
  assert.equal(seen[0].url, 'https://gw.example:443/api/profiles?profile=bot%20one');
  assert.equal(seen[0].auth, 'Bearer a1');
});

test('session_expired gets one refresh and one retry', async () => {
  const s = session();
  const { impl, seen } = fakeFetch([
    { status: 401, body: { error: 'session_expired' } },
    { status: 200, body: { sessions: [] } },
  ]);
  const api = createGatewayApi(s.auth, impl);
  assert.deepEqual(await api.get('/api/sessions'), { sessions: [] });
  assert.deepEqual(
    seen.map((r) => r.auth),
    ['Bearer a1', 'Bearer a2'],
  );
});

test('any other 401 hands the phone back to sign-in', async () => {
  const s = session();
  const { impl } = fakeFetch([{ status: 401, body: { error: 'unauthenticated' } }]);
  await assert.rejects(createGatewayApi(s.auth, impl).get('/api/sessions'), ReauthRequiredError);
  assert.equal(s.reauth.length, 1);
});

test('non-2xx answers surface as ApiError with the status', async () => {
  const { auth } = session();
  const { impl } = fakeFetch([{ status: 404, body: 'nope' }]);
  const error = await createGatewayApi(auth, impl)
    .get('/api/x')
    .catch((e: unknown) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 404);
});

test('buildQuery drops empty values', () => {
  assert.equal(buildQuery({ a: 1, b: undefined, c: null, d: '' }), '?a=1');
  assert.equal(buildQuery({}), '');
});
