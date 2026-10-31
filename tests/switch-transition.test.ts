import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextSeen, type Seen } from '../src/chat/switchTransition.ts';
import { createFitMemo, fitSize, FIT_MIN } from '../src/ui/wordmarkFit.ts';

const start = (key: string, first: string | null = null): Seen => ({ key, first, epoch: 0 });

test('moving to another chat advances the epoch; a re-render of the same chat does not', () => {
  const a = start('sess-a', 'm1');
  assert.equal(nextSeen(a, 'sess-a', 'm1'), a);
  assert.equal(nextSeen(a, 'sess-b', 'x1').epoch, 1);
  assert.equal(nextSeen(a, 'draft', null).epoch, 1);
});

test('a stream growing the open chat never replays the switch', () => {
  let seen = nextSeen(start('sess-a', 'm1'), 'sess-a', 'm1');
  for (let beat = 0; beat < 50; beat += 1) seen = nextSeen(seen, 'sess-a', 'm1');
  assert.equal(seen.epoch, 0);
});

test("the first send re-keys the draft to its session without a switch, because the transcript is the same one", () => {
  let seen = start('draft');
  seen = nextSeen(seen, 'draft', 'live-1-1'); // the reader's bubble lands in the draft
  assert.equal(seen.epoch, 0);
  seen = nextSeen(seen, 'sess-new', 'live-1-1'); // createFromDraft moves the entry under the stored id
  assert.equal(seen.epoch, 0);
  assert.equal(seen.key, 'sess-new');
  // later the reader really does leave
  assert.equal(nextSeen(seen, 'draft', null).epoch, 1);
});

test('leaving a draft for a different chat is a switch, even when that chat has messages', () => {
  const draft = nextSeen(start('draft'), 'draft', 'live-1-1');
  assert.equal(nextSeen(draft, 'sess-old', 'row-9').epoch, 1);
  // and an empty draft opening an empty session is one too
  assert.equal(nextSeen(start('draft'), 'sess-empty', null).epoch, 1);
});

test('a Wordmark that mounts again sizes itself on its first render', () => {
  const memo = createFitMemo();
  assert.equal(fitSize(memo.recall('HERMES AGENT').width, memo.recall('HERMES AGENT').measured), 0, 'first ever mount has to measure');
  memo.noteWidth('HERMES AGENT', 320);
  memo.noteMeasured('HERMES AGENT', 640);
  const again = memo.recall('HERMES AGENT');
  assert.equal(fitSize(again.width, again.measured), (100 * 320 * 0.98) / 640);
  assert.deepEqual(memo.recall('OTHER'), { width: 0, measured: 0 });
});

test('the fit never drops below the floor, and an unmeasured word has no size', () => {
  assert.equal(fitSize(50, 1000), FIT_MIN);
  assert.equal(fitSize(0, 640), 0);
  assert.equal(fitSize(320, 0), 0);
});

test('the memo keeps the newest words and forgets the oldest', () => {
  const memo = createFitMemo();
  for (let i = 0; i < 40; i += 1) memo.noteMeasured(`W${i}`, 100 + i);
  assert.equal(memo.recall('W0').measured, 0);
  assert.equal(memo.recall('W39').measured, 139);
});
