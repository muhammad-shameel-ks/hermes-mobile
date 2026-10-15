import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionInfo } from '../src/chat/controller.ts';
import { createSessionLister, MESSAGING_WINDOW, SESSIONS_MAX_LIMIT, SESSIONS_PAGE_SIZE, widened, type SessionListApi } from '../src/drawer/sessionList.ts';
import { emptySessions, SessionsFeed, type SessionsState } from '../src/drawer/sessionsFeed.ts';
import { MESSAGING_EXCLUDED_SOURCES, RECENTS_EXCLUDED_SOURCES } from '../src/drawer/sessionSources.ts';

const row = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({ id, title: id, preview: null, started_at: 1, ...extra });

type Call = { path: string; query: Record<string, unknown> };

function fakeApi(handler: (path: string, query: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const api: SessionListApi = {
    get: async <T>(path: string, query: Record<string, unknown> = {}) => {
      calls.push({ path, query });
      const result = handler(path, query);
      if (result instanceof Error) throw result;
      return result as T;
    },
  };
  return { api, calls };
}

const sidebar = (recents: SessionInfo[], extra: object = {}) => ({ recents: { sessions: recents, profiles_truncated: { work: false } }, cron: { sessions: [] }, messaging: { sessions: [] }, ...extra });

test('the page reads the batched sidebar route scoped to the profile, with the desktop source filters', async () => {
  const { api, calls } = fakeApi(() => sidebar([row('a')]));
  const page = await createSessionLister(api).page('work', 50);
  assert.equal(calls[0]!.path, '/api/profiles/sessions/sidebar');
  assert.equal(calls[0]!.query.recents_profile, 'work');
  assert.equal(calls[0]!.query.recents_limit, 50);
  assert.equal(calls[0]!.query.messaging_limit, MESSAGING_WINDOW);
  assert.equal(calls[0]!.query.recents_exclude, RECENTS_EXCLUDED_SOURCES.join(','));
  assert.equal(calls[0]!.query.messaging_exclude, MESSAGING_EXCLUDED_SOURCES.join(','));
  assert.deepEqual(page.recents.map((s) => s.id), ['a']);
  assert.equal(page.recentsTruncated, false);
});

test('a truncated window offers more, until the route\'s ceiling', async () => {
  const truncated = { recents: { sessions: [row('a')], profiles_truncated: { work: true } } };
  const { api } = fakeApi(() => truncated);
  assert.equal((await createSessionLister(api).page('work', 50)).recentsTruncated, true);
  assert.equal((await createSessionLister(api).page('work', SESSIONS_MAX_LIMIT)).recentsTruncated, false);
  assert.equal(widened(50), 100);
  assert.equal(widened(480), SESSIONS_MAX_LIMIT);
});

test('rows from sources that never list as conversations are dropped, and a damaged store is flagged', async () => {
  const { api } = fakeApi(() => sidebar([row('chat'), row('job', { source: 'cron' })], { storage: { work: 'corrupt' } }));
  const page = await createSessionLister(api).page('work', 50);
  assert.deepEqual(page.recents.map((s) => s.id), ['chat']);
  assert.equal(page.corrupt, true);
});

test('a failed scan with nothing to show is an error, not an empty list', async () => {
  const { api } = fakeApi(() => ({ recents: { failed: true, retry: true } }));
  await assert.rejects(createSessionLister(api).page('work', 50), /Could not load sessions/);
});

test('a gateway without the batched route falls back to the plain route, once', async () => {
  const { api, calls } = fakeApi((path) => (path === '/api/profiles/sessions/sidebar' ? new Error('GET 404: No such API endpoint') : { sessions: [row('a'), row('b')] }));
  const lister = createSessionLister(api);
  const page = await lister.page('work', 50);
  assert.deepEqual(page.recents.map((s) => s.id), ['a', 'b']);
  const plain = calls.filter((c) => c.path === '/api/sessions');
  assert.equal(plain.length, 2, 'recents and messaging');
  assert.equal(plain[0]!.query.min_messages, 1);
  assert.equal(plain[0]!.query.profile, 'work');
  await lister.page('work', 50);
  assert.equal(calls.filter((c) => c.path === '/api/profiles/sessions/sidebar').length, 1, 'the dead route is not probed again');
});

test('any other failure is not a capability signal', async () => {
  const { api } = fakeApi(() => new Error('timed out'));
  await assert.rejects(createSessionLister(api).page('work', 50), /timed out/);
});

test('search asks the profile\'s search route', async () => {
  const { api, calls } = fakeApi(() => ({ results: [{ session_id: 'x' }] }));
  const out = await createSessionLister(api).search('needle', 'work');
  assert.deepEqual(calls[0], { path: '/api/sessions/search', query: { q: 'needle', profile: 'work' } });
  assert.equal(out[0]!.session_id, 'x');
});

function feedOver(handler: (path: string, query: Record<string, unknown>) => unknown, profile = 'work') {
  const { api, calls } = fakeApi(handler);
  const host = { state: emptySessions(), profile };
  const feed = new SessionsFeed(api, { profile: () => host.profile, get: () => host.state, set: (next: SessionsState) => void (host.state = next) });
  return { feed, host, calls };
}

test('the feed loads once, shows a first read as loading, and then as loaded', async () => {
  const { feed, host } = feedOver(() => sidebar([row('a')]));
  const pending = feed.refresh();
  assert.equal(host.state.loading, true);
  await pending;
  assert.deepEqual([host.state.loading, host.state.loaded, host.state.items.length, host.state.error], [false, true, 1, null]);
});

test('load more raises the window by a page and reads again; it refuses without more', async () => {
  const { feed, host, calls } = feedOver(() => ({ recents: { sessions: [row('a')], profiles_truncated: { work: true } } }));
  await feed.refresh();
  await feed.loadMore();
  assert.equal(calls[0]!.query.recents_limit, SESSIONS_PAGE_SIZE);
  assert.equal(calls[1]!.query.recents_limit, SESSIONS_PAGE_SIZE * 2);
  assert.equal(host.state.loadingMore, false);

  const flat = feedOver(() => sidebar([row('a')]));
  await flat.feed.refresh();
  await flat.feed.loadMore();
  assert.equal(flat.calls.length, 1);
});

test('a failed refresh over rows keeps them and records the error', async () => {
  let fail = false;
  const { feed, host } = feedOver(() => (fail ? new Error('boom') : sidebar([row('a')])));
  await feed.refresh();
  fail = true;
  await feed.refresh();
  assert.equal(host.state.items.length, 1);
  assert.match(host.state.error ?? '', /boom/);
});

test('a reply for a profile that has since changed never lands', async () => {
  const { feed, host } = feedOver(() => sidebar([row('stale')]));
  const pending = feed.refresh();
  host.profile = 'other';
  feed.reset();
  await pending;
  assert.deepEqual(host.state.items, []);
  assert.equal(host.state.loading, true, 'the new profile\'s read is still to come');
});

test('a rename lands on the loaded row without a refetch', async () => {
  const { feed, host, calls } = feedOver(() => sidebar([row('a'), row('b')]));
  await feed.refresh();
  feed.retitle('b', 'Renamed');
  assert.equal(host.state.items[1]!.title, 'Renamed');
  assert.equal(calls.length, 1);
});
