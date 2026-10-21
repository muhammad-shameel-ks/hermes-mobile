import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dragProgress, FLING_VELOCITY, settlesOpen, TAB_SWIPE_PX, tabStep } from '../src/drawer/drawerGesture.ts';

test('an opening drag follows the finger and stops at the ends', () => {
  assert.equal(dragProgress(150, 300), 0.5);
  assert.equal(dragProgress(-40, 300), 0);
  assert.equal(dragProgress(900, 300), 1);
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

test('a left swipe across the drawer moves to the next tab, a right one back', () => {
  assert.equal(tabStep(-TAB_SWIPE_PX, 0), 1);
  assert.equal(tabStep(TAB_SWIPE_PX, 0), -1);
});

test('a short slow swipe keeps the tab', () => {
  assert.equal(tabStep(-(TAB_SWIPE_PX - 1), 0), 0);
  assert.equal(tabStep(TAB_SWIPE_PX - 1, FLING_VELOCITY), 0);
});

test('a fling picks the tab by its direction, whatever the distance', () => {
  assert.equal(tabStep(-20, -FLING_VELOCITY - 1), 1);
  assert.equal(tabStep(20, FLING_VELOCITY + 1), -1);
  // released flicking back the other way: the fling wins
  assert.equal(tabStep(-TAB_SWIPE_PX - 10, FLING_VELOCITY + 1), -1);
});
