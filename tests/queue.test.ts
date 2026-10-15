import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  beginEdit,
  busySendAction,
  clearDrainFailures,
  drainHead,
  drainRetryMs,
  edit,
  emptyQueue,
  endEdit,
  enqueue,
  entryPreview,
  isSteerable,
  MAX_AUTO_DRAIN_ATTEMPTS,
  noteDrainFailure,
  offersExpandedPreview,
  park,
  promote,
  remove,
  shouldAutoDrain,
  unpark,
  type QueueState,
} from '../src/chat/queue.ts';

const filled = (...texts: string[]): QueueState => texts.reduce((queue, text, i) => enqueue(queue, `q${i + 1}`, text, i), emptyQueue());
const ids = (queue: QueueState) => queue.entries.map((entry) => entry.id);

test('entries queue in order and queueing lifts a park and the failure budgets', () => {
  let queue = filled('one', 'two');
  queue = noteDrainFailure(queue, 'q1');
  queue = park(queue);
  assert.equal(queue.parked, true);
  queue = enqueue(queue, 'q3', 'three', 9);
  assert.deepEqual(ids(queue), ['q1', 'q2', 'q3']);
  assert.equal(queue.parked, false);
  assert.equal(queue.entries[0].drainFailures, undefined);
});

test('parking an empty queue does nothing, and emptying a parked queue lifts the park', () => {
  assert.equal(park(emptyQueue()).parked, false);
  let queue = park(filled('one', 'two'));
  queue = remove(queue, 'q1');
  assert.equal(queue.parked, true);
  queue = remove(queue, 'q2');
  assert.equal(queue.parked, false);
  assert.deepEqual(queue.entries, []);
});

test('removing an unknown id leaves the same state', () => {
  const queue = filled('one');
  assert.equal(remove(queue, 'nope'), queue);
});

test('a park holds the drain until it is lifted', () => {
  const idle = { busy: false, length: 2 };
  assert.equal(shouldAutoDrain({ ...idle, parked: false }), true);
  assert.equal(shouldAutoDrain({ ...idle, parked: true }), false);
  assert.equal(shouldAutoDrain({ busy: true, parked: false, length: 2 }), false);
  assert.equal(shouldAutoDrain({ busy: false, parked: false, length: 0 }), false);
  assert.equal(unpark(park(filled('one'))).parked, false);
});

test('promote moves an entry to the head and leaves the order of the rest', () => {
  const queue = promote(filled('one', 'two', 'three'), 'q3');
  assert.deepEqual(ids(queue), ['q3', 'q1', 'q2']);
  assert.equal(promote(queue, 'q3'), queue);
});

test('edit rewrites the text, refuses a blank rewrite and resets the failure budget', () => {
  let queue = noteDrainFailure(filled('one'), 'q1');
  assert.equal(edit(queue, 'q1', '   '), queue);
  queue = edit(queue, 'q1', 'uno');
  assert.equal(queue.entries[0].text, 'uno');
  assert.equal(queue.entries[0].drainFailures, undefined);
});

test('one entry is edited at a time and the drain passes over it', () => {
  let queue = beginEdit(filled('one', 'two'), 'q1');
  assert.equal(queue.editing, 'q1');
  assert.equal(beginEdit(queue, 'q2'), queue);
  assert.equal(drainHead(queue)?.id, 'q2');
  queue = endEdit(queue);
  assert.equal(drainHead(queue)?.id, 'q1');
  assert.equal(remove(beginEdit(filled('one'), 'q1'), 'q1').editing, null);
});

test('an entry that used up its attempts stops the drain until a user gesture clears it', () => {
  let queue = filled('one', 'two');
  for (let i = 0; i < MAX_AUTO_DRAIN_ATTEMPTS; i += 1) queue = noteDrainFailure(queue, 'q1');
  assert.equal(drainHead(queue), undefined);
  queue = clearDrainFailures(queue, 'q1');
  assert.equal(drainHead(queue)?.id, 'q1');
});

test('retries back off linearly, as the desktop does', () => {
  assert.deepEqual([1, 2, 3].map(drainRetryMs), [750, 1500, 2250]);
});

test('Send steers text and queues what a steer cannot carry', () => {
  assert.equal(busySendAction({ text: 'actually use tabs', runtimeBound: true }), 'steer');
  assert.equal(busySendAction({ text: 'actually use tabs', runtimeBound: false }), 'queue');
  assert.equal(busySendAction({ text: 'actually use tabs', runtimeBound: true, blockingPrompt: true }), 'queue');
  assert.equal(busySendAction({ text: '/compact', runtimeBound: true }), 'queue');
  assert.equal(isSteerable('  '), false);
  assert.equal(isSteerable('plain words'), true);
});

test('previews read the text, name an empty turn and offer expansion for long or multiline text', () => {
  assert.equal(entryPreview({ text: '  hello ' }), 'hello');
  assert.equal(entryPreview({ text: '  ' }), 'Empty turn');
  assert.equal(offersExpandedPreview('short'), false);
  assert.equal(offersExpandedPreview('a\nb'), true);
  assert.equal(offersExpandedPreview('x'.repeat(141)), true);
});
