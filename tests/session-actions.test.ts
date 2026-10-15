import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSessionActions, deleteSessionDescription, type SessionActionsApi } from '../src/drawer/session-actions.ts';

type Call = { method: string; path: string; body?: unknown; query?: unknown };

function fakeApi(snapshot: unknown | Error = { session_id: 's1', exists: true, runtime_revision: 7, runtime_generation: 2 }) {
  const calls: Call[] = [];
  const api: SessionActionsApi = {
    get: async (path, query) => {
      calls.push({ method: 'GET', path, query });
      if (snapshot instanceof Error) throw snapshot;
      return snapshot as never;
    },
    patch: async (path, body) => {
      calls.push({ method: 'PATCH', path, body });
      return { ok: true } as never;
    },
    del: async (path, query) => {
      calls.push({ method: 'DELETE', path, query });
      return { ok: true } as never;
    },
  };
  return { api, calls };
}

test('a pin reads the mutation snapshot, then patches with its identity and the profile', async () => {
  const { api, calls } = fakeApi();
  await createSessionActions(api).setPinned('s1', true, 'work');
  assert.deepEqual(calls[0], { method: 'GET', path: '/api/sessions/s1/mutation-snapshot', query: { profile: 'work' } });
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].path, '/api/sessions/s1');
  const body = calls[1].body as Record<string, unknown>;
  assert.equal(body.pinned, true);
  assert.equal(body.profile, 'work');
  assert.equal(body.expected_revision, 7);
  assert.equal(body.expected_generation, 2);
  assert.match(String(body.request_id), /^[0-9a-f-]{36}$/);
});

test('rename and archive send their own payloads', async () => {
  const { api, calls } = fakeApi();
  const actions = createSessionActions(api);
  await actions.rename('s1', 'New name');
  await actions.setArchived('s1', true);
  const bodies = calls.filter((c) => c.method === 'PATCH').map((c) => c.body as Record<string, unknown>);
  assert.equal(bodies[0].title, 'New name');
  assert.equal('profile' in bodies[0], false);
  assert.equal(bodies[1].archived, true);
});

test('a delete carries the identity as query parameters', async () => {
  const { api, calls } = fakeApi();
  await createSessionActions(api).remove('s1', 'work');
  const del = calls.find((c) => c.method === 'DELETE');
  const query = del?.query as Record<string, unknown>;
  assert.equal(query.profile, 'work');
  assert.equal(query.expected_revision, 7);
  assert.ok(query.request_id);
});

test('a gateway without the snapshot route keeps the plain write', async () => {
  const { api, calls } = fakeApi(new Error('GET /api/sessions/s1/mutation-snapshot answered 404: {"detail":"No such API endpoint"}'));
  await createSessionActions(api).setPinned('s1', false);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch?.body, { pinned: false });
});

test('a missing session is the caller’s error, not a fallback', async () => {
  const { api } = fakeApi(new Error('GET /api/sessions/s1/mutation-snapshot answered 404: {"detail":"Not Found"}'));
  await assert.rejects(createSessionActions(api).remove('s1'), /404/);
});

test('the delete confirmation names the session', () => {
  assert.equal(deleteSessionDescription('Trip plan'), 'This will permanently delete “Trip plan”. This cannot be undone.');
});

test('opening a session reads it: unread=false goes through the fenced write', async () => {
  const { api, calls } = fakeApi();
  await createSessionActions(api).setUnread('s1', false, 'work');
  assert.equal(calls[1]!.method, 'PATCH');
  const body = calls[1]!.body as Record<string, unknown>;
  assert.equal(body.unread, false);
  assert.equal(body.profile, 'work');
  assert.equal(body.expected_revision, 7);
});
