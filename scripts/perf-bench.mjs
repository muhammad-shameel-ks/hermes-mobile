#!/usr/bin/env node
// Micro-benchmarks for the pure hot paths, run under plain node (no React Native):
//   npm run perf            all sections
//   npm run perf -- color   only sections whose name contains "color"
//
// Node's V8 is several times faster than Hermes on a phone, so read the numbers as ratios between
// runs of the same machine (before/after a change), never as device milliseconds.

import { performance } from 'node:perf_hooks';

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const rows = [];

/** median of `runs` timed calls after `warm` untimed ones, in milliseconds */
function time(fn, { runs = 9, warm = 2 } = {}) {
  for (let i = 0; i < warm; i += 1) fn();
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], min: samples[0] };
}

async function section(name, body) {
  if (only.length > 0 && !only.some((term) => name.includes(term))) return;
  try {
    await body((label, fn, per, options) => {
      const { median, min } = time(fn, options);
      rows.push({ section: name, label, median, min, per: per ? (median * 1000) / per : null });
    });
  } catch (error) {
    rows.push({ section: name, label: `skipped: ${error instanceof Error ? error.message : error}`, median: NaN, min: NaN, per: null });
  }
}

// ─── transcript: a streamed turn, event by event ─────────────────────────────

await section('transcript', async (bench) => {
  const { applyEvent, emptyTranscript } = await import('../src/chat/transcript.ts');
  const words = 'The quick brown fox jumps over the lazy dog while streaming tokens '.split(' ');
  const events = [{ type: 'message.start' }];
  for (let i = 0; i < 5000; i += 1) {
    if (i % 500 === 0) {
      const id = `t${i}`;
      events.push({ type: 'tool.start', payload: { tool_id: id, name: 'terminal', context: 'ls' } }, { type: 'tool.complete', payload: { tool_id: id, name: 'terminal', summary: 'ok' } });
    }
    events.push({ type: i % 7 === 0 ? 'reasoning.delta' : 'message.delta', payload: { text: `${words[i % words.length]} ` } });
  }
  events.push({ type: 'message.complete', payload: { text: '' } });
  bench(`applyEvent x ${events.length} (5k-delta turn)`, () => events.reduce(applyEvent, emptyTranscript()), events.length);
});

// ─── drawer lists: 2k sessions ───────────────────────────────────────────────

await section('sessions', async (bench) => {
  const index = await import('../src/drawer/sessionIndex.ts');
  const tree = await import('../src/drawer/sessionTree.ts');
  const dates = await import('../src/drawer/sessionDates.ts');
  const items = await import('../src/drawer/sessionListItems.ts');
  const now = Math.floor(Date.now() / 1000);
  const sessions = Array.from({ length: 2000 }, (_, i) => ({
    id: `s${i}`,
    title: i % 5 === 0 ? null : `Session number ${i} about topic ${i % 37}`,
    preview: `preview text for ${i}`,
    started_at: now - i * 1700,
    last_active: now - i * 1700 + 60,
    source: i % 9 === 0 ? 'telegram' : null,
    pinned: i % 50 === 0,
    parent_session_id: i % 11 === 0 && i > 0 ? `s${i - 1}` : null,
    _branched_from: i % 11 === 0 && i > 0 ? `s${i - 1}` : null,
    message_count: 4,
  }));
  const recents = sessions.filter((s) => !s.source);
  const messaging = sessions.filter((s) => s.source);
  bench('splitPinned + messagingGroups', () => {
    const split = index.splitPinned(recents, messaging);
    index.messagingGroups(split.messaging, false);
  });
  bench('flattenSessionsWithBranches (1.8k)', () => tree.flattenSessionsWithBranches(recents, { preserveOrder: false }));
  const entries = tree.flattenSessionsWithBranches(recents, { preserveOrder: false });
  bench('groupEntriesByRecency (1.8k)', () => dates.groupEntriesByRecency(entries));
  const rowsList = dates.groupEntriesByRecency(entries);
  bench('buildSessionListItems (flat cells)', () =>
    items.buildSessionListItems({
      query: '',
      results: { rows: [], pending: false },
      pinsOpen: true,
      recentsOpen: true,
      closedGroups: [],
      pinned: [],
      recents: { rows: rowsList, skeletons: false, loadError: false, allPinned: false, footer: null },
      platforms: [],
    }),
  );
  const sorted = [...sessions].sort((a, b) => b.last_active - a.last_active);
  const byAnyId = index.buildSessionByAnyId(recents, messaging);
  bench('mergeSearchResults, one keystroke (client match)', () => index.mergeSearchResults(sorted, 'topic 12', [], byAnyId, true, 'default'));
});

// ─── colour: the resolved theme and the per-render derivations ───────────────

await section('color', async (bench) => {
  const color = await import('../src/ui/color.ts');
  const tokens = await import('../src/ui/tokens.ts');
  const { SKINS } = await import('../src/ui/skins.ts');
  let n = 0;
  bench('resolveTheme, every skin x mode, cold (one run)', () => {
    for (const skin of SKINS) for (const mode of ['light', 'dark']) tokens.resolveTheme({ skin: skin.name, mode });
  }, SKINS.length * 2, { runs: 1, warm: 0 });
  bench('Chat Text Size drag: 40 scale steps', () => {
    for (let i = 0; i < 40; i += 1) tokens.resolveTheme({ skin: 'nous', mode: 'dark', chatTextScale: 1 + (n += 1) / 1e6 });
  }, 40);
  bench('mixPct x 100k (a render path)', () => {
    for (let i = 0; i < 100_000; i += 1) color.mixPct('#0053fd', 0.4 + (i % 4) / 10, 'transparent');
  }, 100_000);
});

// ─── persistence: the warm tail ──────────────────────────────────────────────

await section('store', async (bench) => {
  const { serializeTail } = await import('../src/store/sessions.ts');
  const message = (i, bytes) => ({ id: `m${i}`, role: 'assistant', status: 'complete', parts: [{ kind: 'text', text: 'x'.repeat(bytes) }] });
  const typical = Array.from({ length: 200 }, (_, i) => message(i, 2_000));
  const heavy = Array.from({ length: 200 }, (_, i) => message(i, 400_000));
  bench('serializeTail, typical 200-message transcript', () => serializeTail(typical));
  bench('serializeTail, 200 messages of 400 KB tool output', () => serializeTail(heavy));
});

const width = Math.max(...rows.map((row) => row.label.length));
let last = '';
for (const row of rows) {
  if (row.section !== last) console.log(`\n${row.section}`);
  last = row.section;
  const per = row.per === null ? '' : `  ${row.per.toFixed(2)} us each`;
  console.log(`  ${row.label.padEnd(width)}  ${Number.isNaN(row.median) ? '' : `${row.median.toFixed(2).padStart(9)} ms (min ${row.min.toFixed(2)})`}${per}`);
}
console.log('');
