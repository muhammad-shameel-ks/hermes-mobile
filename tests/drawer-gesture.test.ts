import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dragProgress, FLING_VELOCITY, settlesOpen } from '../src/drawer/drawerGesture.ts';

test('an opening drag follows the finger and stops at the ends', () => {
  assert.equal(dragProgress(0, 150, 300), 0.5);
  assert.equal(dragProgress(0, -40, 300), 0);
  assert.equal(dragProgress(0, 900, 300), 1);
});

test('a closing drag starts from fully open', () => {
  assert.equal(dragProgress(1, 0, 300), 1);
  assert.equal(dragProgress(1, -75, 300), 0.75);
  assert.equal(dragProgress(1, -900, 300), 0);
  assert.equal(dragProgress(1, 60, 300), 1);
});

test('a slow release settles on the nearer end', () => {
  assert.equal(settlesOpen(0.51, 0), true);
  assert.equal(settlesOpen(0.49, 0), false);
  assert.equal(settlesOpen(0.5, 0), false);
});

test('a fling decides against the position', () => {
  assert.equal(settlesOpen(0.1, FLING_VELOCITY + 1), true);
  assert.equal(settlesOpen(0.9, -FLING_VELOCITY - 1), false);
  assert.equal(settlesOpen(0.9, -FLING_VELOCITY), true);
});
