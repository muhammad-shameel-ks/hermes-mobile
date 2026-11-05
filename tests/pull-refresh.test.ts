import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pullArmed, pullSpinner } from '../src/ui/pullRefresh.ts';

test('an ordinary top-of-list bounce does not arm the loader', () => {
  assert.equal(pullArmed(-20, false, false, false), false);
  assert.equal(pullArmed(-55, false, false, false), false);
  // a pull past the arming distance is meant
  assert.equal(pullArmed(-80, false, false, false), true);
});

test('once armed, easing back above the arming distance keeps it armed', () => {
  assert.equal(pullArmed(-30, true, false, false), true);
  // only the list's own top disarms it
  assert.equal(pullArmed(0, true, false, false), false);
});

test('the spring-back after a refresh is not a new pull', () => {
  // the inset carries the list well past the arming distance, but the app consumed that pull already
  assert.equal(pullArmed(-75, false, true, false), false);
  assert.equal(pullArmed(-75, false, false, true), false);
});

test('a refresh the app started shows no spinner and inserts no header', () => {
  // a drawer opening or a screen mounting: `refreshing` is true, but no pull of the reader's is behind it
  assert.equal(pullSpinner(true, false, false), false);
});

test('the spinner drops on the render that hears a refresh end, before any effect clears the flag', () => {
  // the stuck-spinner bug: `started` is still true here (it is cleared in an effect, which does not re-render)
  assert.equal(pullSpinner(true, true, true), true);
  assert.equal(pullSpinner(false, true, true), false);
  assert.equal(pullSpinner(false, true, false), false);
});
