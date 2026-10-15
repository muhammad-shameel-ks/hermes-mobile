import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evictions, Recency } from '../src/store/lru.ts';

test('the oldest unprotected keys go once past the cap', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(evictions(order, () => false, 3), ['a', 'b']);
  assert.deepEqual(evictions(order, () => false, 5), []);
});

test('protected keys neither count toward the cap nor get dropped', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(evictions(order, (key) => key === 'a' || key === 'b', 2), ['c']);
});

test('touching a key makes it the newest', () => {
  const recency = new Recency();
  for (const key of ['a', 'b', 'c']) recency.touch(key);
  recency.touch('a');
  assert.deepEqual(recency.keys(), ['b', 'c', 'a']);
  recency.forget('c');
  assert.deepEqual(recency.keys(), ['b', 'a']);
  assert.equal(recency.has('c'), false);
});
