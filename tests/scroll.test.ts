import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceFromBottom, jumpLabel, messagesBelow, type RowFrame } from '../src/chat/scroll.ts';

const ids = ['a', 'b', 'c', 'd'];
const frames = new Map<string, RowFrame>([
  ['a', { y: 0, height: 100 }],
  ['b', { y: 100, height: 100 }],
  ['c', { y: 200, height: 300 }],
  ['d', { y: 500, height: 100 }],
]);

test('nothing is below when the viewport reaches the last row', () => {
  assert.equal(messagesBelow(ids, frames, 600), 0);
  assert.equal(messagesBelow(ids, frames, 900), 0);
});

test('a row straddling the fold counts, rows above it do not', () => {
  assert.equal(messagesBelow(ids, frames, 550), 1);
  assert.equal(messagesBelow(ids, frames, 300), 2);
  assert.equal(messagesBelow(ids, frames, 150), 3);
});

test('a row ending within a pixel of the fold reads as on screen', () => {
  assert.equal(messagesBelow(ids, frames, 499.5), 1);
});

test('unmeasured rows at the tail count as below', () => {
  const partial = new Map(frames);
  partial.delete('d');
  assert.equal(messagesBelow(ids, partial, 500), 1);
  assert.equal(messagesBelow([...ids, 'e'], partial, 300), 3);
});

test('distance from bottom never goes negative', () => {
  assert.equal(distanceFromBottom(0, 800, 400), 0);
  assert.equal(distanceFromBottom(100, 500, 1000), 400);
});

test('the label carries a singular or plural count, or none', () => {
  assert.equal(jumpLabel(0), 'Scroll to bottom');
  assert.equal(jumpLabel(1), 'Scroll to bottom · 1 message');
  assert.equal(jumpLabel(4), 'Scroll to bottom · 4 messages');
});
