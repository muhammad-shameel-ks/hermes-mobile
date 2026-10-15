import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionInfo } from '../src/chat/controller.ts';
import {
  buildSessionByAnyId,
  mergeSearchResults,
  messagingGroups,
  searchResultToSession,
  sessionMatchesSearch,
  sessionTitle,
  splitPinned,
  stripFtsMarkers,
  type SessionSearchResult,
} from '../src/drawer/sessionIndex.ts';
import { isMessagingSource, sessionSourceLabel } from '../src/drawer/sessionSources.ts';

const row = (id: string, last: number, extra: Partial<SessionInfo> = {}): SessionInfo => ({ id, title: id, preview: null, started_at: last, last_active: last, ...extra });

test('a row is titled by its title, then its first words, then a placeholder', () => {
  assert.equal(sessionTitle({ title: '  Plan  ', preview: 'x' }), 'Plan');
  assert.equal(sessionTitle({ title: '', preview: ' fix the build ' }), 'fix the build');
  assert.equal(sessionTitle({ title: null, preview: null }), 'Untitled session');
});

test('search matches the id, lineage root, title, preview, cwd, branch and platform names', () => {
  const s = row('abc123', 1, { title: 'Deploy', preview: 'ship it', cwd: '/srv/app', git_branch: 'feat/x', source: 'telegram', _lineage_root_id: 'root9' });
  for (const q of ['abc1', 'root9', 'deploy', 'ship', '/srv', 'feat/x', 'telegram', 'tg']) assert.ok(sessionMatchesSearch(s, q), q);
  assert.ok(!sessionMatchesSearch(s, 'nope'));
  assert.ok(sessionMatchesSearch(s, '   '));
});

test('the server flag decides what is pinned, from either list, newest first', () => {
  const split = splitPinned([row('a', 5, { pinned: true }), row('b', 9)], [row('m', 7, { pinned: true, source: 'slack' }), row('n', 1, { source: 'slack' })]);
  assert.deepEqual(split.pinned.map((s) => s.id), ['m', 'a']);
  assert.deepEqual(split.recents.map((s) => s.id), ['b']);
  assert.deepEqual(split.messaging.map((s) => s.id), ['n']);
  assert.equal(split.pinnedBySource.get('slack'), 1);
});

test('a pin stored on a lineage root resolves to the live tip', () => {
  const map = buildSessionByAnyId([row('tip', 1, { _lineage_root_id: 'root' })]);
  assert.equal(map.get('root')?.id, 'tip');
  assert.equal(map.get('tip')?.id, 'tip');
});

test('platform groups lead with the most recently active and order rows by recency', () => {
  const groups = messagingGroups([row('t1', 5, { source: 'telegram' }), row('d1', 9, { source: 'Discord' }), row('t2', 8, { source: 'telegram' }), row('nosource', 99)], true);
  assert.deepEqual(groups.map((g) => g.sourceId), ['discord', 'telegram']);
  assert.deepEqual(groups[1]!.sessions.map((s) => s.id), ['t2', 't1']);
  assert.equal(groups[0]!.label, 'Discord');
  assert.ok(groups.every((g) => g.hasMore));
});

test('source ids classify and label', () => {
  assert.ok(isMessagingSource('Telegram'));
  assert.ok(!isMessagingSource('cli'));
  assert.equal(sessionSourceLabel('bluebubbles'), 'iMessage');
  assert.equal(sessionSourceLabel('my_new-thing'), 'My New Thing');
});

test('FTS highlight markers are stripped from the snippet that stands in for the preview', () => {
  assert.equal(stripFtsMarkers('say >>>hello<<< world'), 'say hello world');
  const hit: SessionSearchResult = { session_id: 's', title: ' Named ', snippet: 'a >>>b<<<', lineage_root: 'r', last_active: 20, session_started: 10, source: 'cli' };
  const session = searchResultToSession(hit);
  assert.deepEqual([session.id, session.title, session.preview, session._lineage_root_id, session.last_active, session.started_at], ['s', 'Named', 'a b', 'r', 20, 10]);
  assert.equal(searchResultToSession({ session_id: 'u', snippet: '' }, 77).last_active, 77);
});

test('while the request is in flight search is the loaded rows that match, in recency order', () => {
  const sorted = [row('new', 9, { title: 'alpha one' }), row('old', 1, { title: 'alpha two' }), row('other', 5, { title: 'beta' })];
  const out = mergeSearchResults(sorted, 'alpha', [{ session_id: 'ghost', title: 'alpha ghost' }], new Map(), true);
  assert.deepEqual(out.map((s) => s.id), ['new', 'old']);
});

test('once the ranked reply lands it decides the order, then client-only matches follow', () => {
  const sorted = [row('new', 9, { title: 'quoting abc', cwd: '/alpha' }), row('exact', 1, { title: 'exact' })];
  const byAny = buildSessionByAnyId(sorted);
  const out = mergeSearchResults(sorted, 'alpha', [{ session_id: 'exact' }, { session_id: 'far', title: 'Far away' }], byAny, false);
  assert.deepEqual(out.map((s) => s.id), ['exact', 'far', 'new']);
  assert.equal(out[1]!.title, 'Far away');
  assert.deepEqual(mergeSearchResults(sorted, '', [], byAny, false), []);
});
