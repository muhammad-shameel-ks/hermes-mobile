import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareVersions, formatBytes, isNewer, notesPreview, parseRelease, progressFraction, type Release } from '../src/updates/release.ts';
import { AUTO_CHECK_INTERVAL_MS, UpdateStore, type UpdaterDeps } from '../src/updates/store.ts';

const githubRelease = {
  tag_name: 'v0.1.6',
  html_url: 'https://github.com/muhammad-shameel-ks/hermes-mobile/releases/tag/v0.1.6',
  draft: false,
  prerelease: false,
  published_at: '2026-10-16T10:00:00Z',
  body: "### What's changed\n\n- Add the in-app updater ([abc1234](https://github.com/x/y/commit/abc1234))\n- Fix the drawer ([def5678](https://github.com/x/y/commit/def5678))\n\n**Full changelog:** https://github.com/x/y/compare/v0.1.5...v0.1.6\n",
  assets: [
    { name: 'checksums.txt', browser_download_url: 'https://example.com/checksums.txt', size: 10 },
    { name: 'hermes-0.1.6.apk', browser_download_url: 'https://example.com/hermes-0.1.6.apk', size: 52_428_800 },
  ],
};

test('versions compare numerically, ignoring a leading v and build metadata', () => {
  assert.ok(isNewer('v0.1.10', '0.1.9'));
  assert.ok(isNewer('1.0', '0.9.9'));
  assert.equal(compareVersions('0.1.5', 'v0.1.5'), 0);
  assert.equal(compareVersions('0.1.5+12.gabc', '0.1.5'), 0);
  assert.ok(compareVersions('0.1.4', '0.1.5') < 0);
  assert.equal(compareVersions('nightly', '0.1.5'), 0);
  assert.ok(!isNewer('nightly', '0.1.5'));
});

test('a GitHub release reads as the version, notes and APK asset', () => {
  assert.deepEqual(parseRelease(githubRelease), {
    version: '0.1.6',
    tag: 'v0.1.6',
    notes: githubRelease.body.trim(),
    pageUrl: githubRelease.html_url,
    apkUrl: 'https://example.com/hermes-0.1.6.apk',
    apkName: 'hermes-0.1.6.apk',
    apkSize: 52_428_800,
    publishedAt: '2026-10-16T10:00:00Z',
  });
  assert.equal(parseRelease({ ...githubRelease, assets: [] }), null);
  assert.equal(parseRelease({ ...githubRelease, prerelease: true }), null);
  assert.equal(parseRelease({ ...githubRelease, tag_name: 'latest' }), null);
  assert.equal(parseRelease(null), null);
});

test('release notes preview keeps the commit subjects without links', () => {
  assert.equal(notesPreview(githubRelease.body), '• Add the in-app updater\n• Fix the drawer');
  assert.equal(notesPreview('- a\n- b\n- c', 2), '• a\n• b\n…and 1 more');
  assert.equal(notesPreview('Plain text with a [link](https://x)'), 'Plain text with a link');
});

test('sizes and progress read for people', () => {
  assert.equal(formatBytes(52_428_800), '50.0 MB');
  assert.equal(formatBytes(0), '');
  assert.equal(progressFraction(5, 10), 0.5);
  assert.equal(progressFraction(5, -1), null);
});

const release = parseRelease(githubRelease) as Release;

function harness(overrides: Partial<UpdaterDeps> = {}) {
  let clock = 1_000_000;
  const calls = { fetch: 0, installs: [] as string[], skipped: [] as Array<string | null> };
  const deps: UpdaterDeps = {
    currentVersion: '0.1.5',
    fetchLatest: async () => {
      calls.fetch++;
      return release;
    },
    download: async (_release, onProgress) => {
      onProgress(25, 100);
      onProgress(100, 100);
      return 'file:///cache/hermes-0.1.6.apk';
    },
    install: async (uri) => {
      calls.installs.push(uri);
    },
    loadSkipped: async () => null,
    saveSkipped: async (version) => {
      calls.skipped.push(version);
    },
    now: () => clock,
    ...overrides,
  };
  const store = new UpdateStore(deps);
  return { store, calls, tick: (ms: number) => (clock += ms) };
}

test('a launch check that finds a newer release raises the prompt', async () => {
  const { store } = harness();
  await store.check('auto');
  assert.equal(store.getSnapshot().kind, 'available');
  assert.ok(store.shouldPrompt());
});

test('a manual check reports the result in place without the prompt', async () => {
  const { store } = harness();
  await store.check('manual');
  assert.equal(store.getSnapshot().kind, 'available');
  assert.ok(!store.shouldPrompt());

  const current = harness({ fetchLatest: async () => ({ ...release, version: '0.1.5' }) });
  await current.store.check('manual');
  assert.deepEqual(current.store.getSnapshot(), { kind: 'current', checkedAt: 1_000_000, latest: '0.1.5' });
});

test('automatic checks are throttled; manual checks are not', async () => {
  const { store, calls, tick } = harness({ fetchLatest: async () => (calls.fetch++, null) });
  await store.check('auto');
  await store.check('auto');
  assert.equal(calls.fetch, 1);
  await store.check('manual');
  assert.equal(calls.fetch, 2);
  tick(AUTO_CHECK_INTERVAL_MS);
  await store.check('auto');
  assert.equal(calls.fetch, 3);
});

test('a failed background check stays silent; a failed manual one says why', async () => {
  const failing = { fetchLatest: async () => Promise.reject(new Error('GitHub answered 403')) };
  const auto = harness(failing);
  await auto.store.check('auto');
  assert.equal(auto.store.getSnapshot().kind, 'idle');

  const manual = harness(failing);
  await manual.store.check('manual');
  assert.deepEqual(manual.store.getSnapshot(), { kind: 'error', origin: 'manual', message: 'GitHub answered 403', release: null });
});

test('updating downloads with progress and opens the installer', async () => {
  const { store, calls } = harness();
  await store.check('auto');
  const progress: Array<number | null> = [];
  store.subscribe(() => {
    const s = store.getSnapshot();
    if (s.kind === 'downloading') progress.push(s.progress);
  });
  await store.update();
  assert.deepEqual(progress, [null, 0.25, 1]);
  assert.equal(store.getSnapshot().kind, 'ready');
  assert.deepEqual(calls.installs, ['file:///cache/hermes-0.1.6.apk']);

  // backing out of the installer leaves the download ready to install again
  await store.install();
  assert.equal(calls.installs.length, 2);
});

test('a failed download can be retried', async () => {
  let attempts = 0;
  const { store } = harness({
    download: async () => {
      if (attempts++ === 0) throw new Error('Network lost');
      return 'file:///cache/hermes.apk';
    },
  });
  await store.check('manual');
  await store.update();
  assert.deepEqual(store.getSnapshot(), { kind: 'error', origin: 'manual', message: 'Network lost', release });
  await store.update();
  assert.equal(store.getSnapshot().kind, 'ready');
});

test('later hides the prompt for the session; skip remembers the version', async () => {
  const later = harness();
  await later.store.check('auto');
  later.store.dismiss();
  assert.ok(!later.store.shouldPrompt());
  assert.equal(later.store.getSnapshot().kind, 'available');

  const skipped = harness();
  await skipped.store.check('auto');
  await skipped.store.skip();
  assert.ok(!skipped.store.shouldPrompt());
  assert.deepEqual(skipped.calls.skipped, ['0.1.6']);

  // the next launch stays quiet for the skipped version, but a manual check still offers it
  const relaunch = harness({ loadSkipped: async () => '0.1.6' });
  await relaunch.store.check('auto');
  assert.equal(relaunch.store.getSnapshot().kind, 'idle');
  await relaunch.store.check('manual');
  assert.equal(relaunch.store.getSnapshot().kind, 'available');

  // a newer release than the skipped one prompts again
  const newer = harness({ loadSkipped: async () => '0.1.6', fetchLatest: async () => ({ ...release, version: '0.1.7' }) });
  await newer.store.check('auto');
  assert.ok(newer.store.shouldPrompt());
});
