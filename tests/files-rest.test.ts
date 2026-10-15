import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, type GatewayApi } from '../src/gateway/api.ts';
import { createFilesRest, createReviewRest, downloadUrl, errorMessage } from '../src/files/rest.ts';

function recorder(answer: unknown = {}) {
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = [];
  const api = {
    get: async (path: string, query?: unknown) => (calls.push({ method: 'GET', path, query }), answer),
    post: async (path: string, body?: unknown) => (calls.push({ method: 'POST', path, body }), answer),
  } as unknown as GatewayApi;
  return { api, calls };
}

test('the files root lists with no path and makes folders by absolute path', async () => {
  const { api, calls } = recorder({ entries: [] });
  const rest = createFilesRest(api, () => 'default');
  await rest.list();
  await rest.mkdir('/opt/data/new');
  assert.deepEqual(calls[0], { method: 'GET', path: '/api/files', query: { path: undefined } });
  assert.deepEqual(calls[1], { method: 'POST', path: '/api/files/mkdir', body: { path: '/opt/data/new' } });
});

test('a linked file is read singly with the active profile', async () => {
  const { api, calls } = recorder({ text: 'x' });
  const rest = createFilesRest(api, () => 'ada');
  await rest.readText('/srv/a.ts');
  assert.deepEqual(calls[0], { method: 'GET', path: '/api/fs/read-text', query: { path: '/srv/a.ts', profile: 'ada' } });
});

test('review reads carry the scope, and the base only for the last turn', async () => {
  const { api, calls } = recorder({ files: [], base: null, diff: '' });
  const rest = createReviewRest(api);
  await rest.list('/repo', 'uncommitted', 'abc');
  await rest.list('/repo', 'lastTurn', 'abc');
  await rest.diff('/repo', 'a.ts', 'branch', 'abc', false);
  assert.deepEqual(calls[0].query, { path: '/repo', scope: 'uncommitted', base: undefined });
  assert.deepEqual(calls[1].query, { path: '/repo', scope: 'lastTurn', base: 'abc' });
  assert.deepEqual(calls[2].query, { path: '/repo', file: 'a.ts', scope: 'branch', base: undefined, staged: false });
  assert.ok(calls.every((c) => c.method === 'GET'));
});

test('download urls differ by origin and encode the path', () => {
  assert.equal(downloadUrl('https://h', { origin: 'files', path: '/opt/data/a b.txt' }), 'https://h/api/files/download?path=%2Fopt%2Fdata%2Fa%20b.txt');
  assert.equal(downloadUrl('https://h', { origin: 'link', path: '/srv/a.ts', profile: 'ada', sessionId: 's1' }), 'https://h/api/fs/download?path=%2Fsrv%2Fa.ts&profile=ada&session_id=s1');
});

test('an error shows the server detail when there is one', () => {
  assert.equal(errorMessage(new ApiError('GET', '/api/files', 403, '{"detail":"Path outside managed files root"}')), 'Path outside managed files root');
  assert.match(errorMessage(new ApiError('GET', '/api/files', 502, 'bad gateway')), /answered 502/);
  assert.equal(errorMessage(new Error('boom')), 'boom');
});
