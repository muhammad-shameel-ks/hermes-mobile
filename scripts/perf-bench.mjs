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

// ─── stream: the final answer after a tool-heavy turn, beat by beat ──────────

/** a final answer the way agents write them after tool calls: a list with bold labels, a fence, a table, bullets, prose */
function finalAnswer(repeat) {
  let text = '## Summary\n\nI checked the **build pipeline**, the `metro.config.js` file and the CI logs. Here is what I found.\n\n';
  for (let r = 0; r < repeat; r += 1) {
    text += '1. **Metro cache**: the cache was stale after the `expo` upgrade, so `npx expo start -c` fixes it.\n';
    text += '2. **Hermes flags**: the `jsEngine` key is set twice in `app.json`; the second one wins.\n';
    text += '3. **CI timeout**: the iOS job runs `pod install` without a cache, which takes about *eleven minutes*.\n';
    text += '4. **Lint**: three files fail `eslint --max-warnings 0`, see [the log](https://ci.example.com/run/123).\n\n';
    text += 'The fix for the first two is small:\n\n```ts\n';
    for (let i = 0; i < 20; i += 1) text += `const option${i} = resolveOption(config, 'key${i}', { fallback: ${i} });\n`;
    text += '```\n\n| File | Problem | Fix |\n|---|---|---|\n';
    for (let i = 0; i < 10; i += 1) text += `| \`src/file${i}.ts\` | **unused** import of \`thing${i}\` | remove line ${i * 3} |\n`;
    text += '\n- First bullet with `code` and **bold** text that runs a while to wrap.\n- Second bullet, plain.\n- Third bullet with a [link](https://example.com).\n\n';
    text += `${'After these changes the build passes locally. The remaining risk is the CI cache, which needs a secret. '.repeat(3)}\n\n`;
  }
  return text;
}

await section('stream', async (bench) => {
  const { applyEvent, emptyTranscript, addUserMessage } = await import('../src/chat/transcript.ts');
  const { TranscriptRows } = await import('../src/chat/transcriptRows.ts');
  const { blocks } = await import('../src/chat/messageBlocks.ts');
  const { deriveTail } = await import('../src/chat/turnActivity.ts');
  const { splitMarkdownBlocks } = await import('../src/chat/markdownBlocks.ts');
  const { splitMediaTags } = await import('../src/chat/media.ts');
  const { StreamReveal } = await import('../src/chat/streamReveal.ts');
  const { fadeTail } = await import('../src/chat/streamFade.ts');
  const { BlockKeys } = await import('../src/chat/markdownKeys.ts');
  const { counterKeys, markdownTree } = await import('../tests/support/markdownTree.ts');
  const { lexer } = await import('marked');
  const { createElement } = await import('react');
  const lex = (src) => lexer(src, { gfm: true });

  // reasoning, a line of text, six tool calls with 40 KB results, then the answer in 4-character deltas, three to a 50 ms beat
  const answer = finalAnswer(3);
  const before = [{ type: 'message.start' }];
  const thought = 'Let me think about which files matter for this build failure. '.repeat(10);
  for (let i = 0; i < thought.length; i += 4) before.push({ type: 'reasoning.delta', payload: { text: thought.slice(i, i + 4) } });
  before.push({ type: 'message.delta', payload: { text: 'Let me look at the config and the CI logs.' } });
  for (let t = 0; t < 6; t += 1) {
    const name = t % 2 ? 'read_file' : 'terminal';
    before.push({ type: 'tool.start', payload: { tool_id: `t${t}`, name, context: `step ${t}` } });
    before.push({ type: 'tool.complete', payload: { tool_id: `t${t}`, name, summary: 'ok', result: { output: 'x'.repeat(40 * 1024) } } });
  }
  const beats = [];
  for (let i = 0; i < answer.length; i += 12) beats.push([0, 4, 8].map((d) => ({ type: 'message.delta', payload: { text: answer.slice(i + d, i + d + 4) } })).filter((e) => e.payload.text));
  const start = before.reduce(applyEvent, addUserMessage(emptyTranscript(), 'why does the build fail?'));

  /** the per-beat work of the store and the transcript rows (urgent render inputs) */
  const storeSide = () => {
    const rows = new TranscriptRows();
    let state = start;
    for (const beat of beats) {
      state = beat.reduce(applyEvent, state);
      rows.sync(state.messages, state.running);
      const live = state.messages[state.messages.length - 1];
      blocks(live.parts);
      deriveTail(state.messages, state.running, state.wait);
    }
    return state;
  };
  const texts = [];
  {
    let state = start;
    for (const beat of beats) {
      state = beat.reduce(applyEvent, state);
      const content = blocks(state.messages[state.messages.length - 1].parts);
      texts.push(content[content.length - 1].text);
    }
  }
  bench(`store side per beat (reducer, rows, blocks, tail) x ${beats.length}`, storeSide, beats.length);

  /** the deferred markdown pass: media split, block split, and a lex of the open block only when the split did not carry its tokens */
  bench(`markdown per beat (split + open-block lex) x ${beats.length}`, () => {
    let state = null;
    for (const text of texts) {
      splitMediaTags(text);
      state = splitMarkdownBlocks(text, lex, state);
      const open = state.blocks[state.blocks.length - 1];
      if (!open.tokens) lex(open.text);
    }
  }, texts.length);

  // the open block's top-level keys, beat to beat: a key that changes while the element keeps its type remounts it and every native view under it
  const remounts = (keys) => {
    let count = 0;
    let state = null;
    let last = { index: -1, types: '', keys: '' };
    for (const text of texts) {
      state = splitMarkdownBlocks(text, lex, state);
      const index = state.blocks.length - 1;
      const top = markdownTree(state.blocks[index].text, keys);
      const now = { index, types: top.map((node) => String(node.type)).join(), keys: top.map((node) => node.key).join() };
      if (now.index === last.index && now.types === last.types && now.keys !== last.keys) count += 1;
      last = now;
    }
    return count;
  };
  const note = (label) => rows.push({ section: 'stream', label, median: NaN, min: NaN, per: null });
  note(`open-block remounts over ${texts.length} beats: post-order counter ${remounts(counterKeys())}, BlockKeys ${remounts(new BlockKeys())}`);

  // one reveal tick on the largest open block of the answer: the spans, then the repaint of its elements
  const painter = {
    slots: (element) => (Array.isArray(element.props.li) ? ['li'] : ['children']),
    ink: () => undefined,
    dim: (element) => element,
    paint: (text, ink, alpha, key) => createElement('paint', { key, ink, alpha }, text),
  };
  let sample = texts[0];
  let openText = '';
  for (const text of texts) {
    const split = splitMarkdownBlocks(text, lex);
    const open = split.blocks[split.blocks.length - 1].text;
    if (open.length > openText.length) [sample, openText] = [text, open];
  }
  const elements = markdownTree(openText, new BlockKeys());
  const reveal = new StreamReveal();
  reveal.arrive(sample.length - 40, 0);
  reveal.arrive(sample.length, 1_000);
  const from = sample.length - openText.length;
  bench(`reveal tick (spans + fadeTail, ${openText.length}-char open block) x 100`, () => {
    for (let i = 0; i < 100; i += 1) fadeTail(elements, reveal.spans(from, sample.length, 1_000 + (i % 50)), '#000', painter);
  }, 100);
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
  const { reuseList } = await import('../src/chat/selector.ts');
  const refetched = structuredClone(recents);
  bench('reuseList, unchanged refetch (1.8k)', () => reuseList(recents, refetched, (s) => s.id));
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
