import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clampScale,
  clampView,
  containSize,
  DOUBLE_TAP_SCALE,
  doubleTapView,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  panLimit,
  pinchView,
  zoomAbout,
} from '../src/ui/zoom.ts';

const stage = { width: 400, height: 800 };
const content = { width: 400, height: 200 };

test('scale stays inside the desktop zoom limits', () => {
  assert.equal(clampScale(0.01), MIN_SCALE);
  assert.equal(clampScale(100), MAX_SCALE);
  assert.equal(clampScale(2), 2);
  assert.equal(MIN_SCALE, 0.25);
  assert.equal(MAX_SCALE, 8);
});

test('a picture is fitted inside the stage without distortion', () => {
  assert.deepEqual(containSize({ width: 1000, height: 500 }, stage), { width: 400, height: 200 });
  assert.deepEqual(containSize({ width: 100, height: 400 }, stage), { width: 200, height: 800 });
  assert.deepEqual(containSize({ width: 0, height: 0 }, stage), stage, 'an unknown size fills the stage');
});

test('panning is bounded by the picture edge meeting the stage edge', () => {
  assert.equal(panLimit(400, 400, 1), 0);
  assert.equal(panLimit(400, 400, 3), 400);
  assert.equal(panLimit(200, 800, 3), 0, 'a picture still smaller than the stage stays centred');
  assert.equal(panLimit(200, 800, 8), 400);
  assert.equal(panLimit(400, 400, 0.5), 0);
});

test('a view is pulled back inside its pan limits', () => {
  assert.deepEqual(clampView({ scale: 2, x: 999, y: -999 }, content, stage), { scale: 2, x: 200, y: 0 });
  assert.deepEqual(clampView({ scale: 1, x: 50, y: 50 }, content, stage), { scale: 1, x: 0, y: 0 });
});

test('zooming holds the focal point still and respects the limits', () => {
  const view = zoomAbout(IDENTITY, 2, { x: 100, y: 0 }, content, stage);
  assert.equal(view.scale, 2);
  // the point under the finger at (100, 0) maps to the same place: 100 - 2 * (100 - 0) shifted back
  assert.equal(view.x, -100);
  assert.equal(zoomAbout(IDENTITY, 50, { x: 0, y: 0 }, content, stage).scale, MAX_SCALE);
  assert.equal(zoomAbout(IDENTITY, 0.001, { x: 0, y: 0 }, content, stage).scale, MIN_SCALE);
});

test('a pinch scales from where it began and follows the fingers', () => {
  const view = pinchView(IDENTITY, 2, { x: 0, y: 0 }, { x: 30, y: 0 }, content, stage);
  assert.deepEqual(view, { scale: 2, x: 30, y: 0 });
  const capped = pinchView({ scale: 4, x: 0, y: 0 }, 10, { x: 0, y: 0 }, { x: 0, y: 0 }, content, stage);
  assert.equal(capped.scale, MAX_SCALE);
});

test('a double tap zooms a fitted picture in on the tap and resets a zoomed one', () => {
  const zoomed = doubleTapView(IDENTITY, { x: 100, y: 0 }, content, stage);
  assert.equal(zoomed.scale, DOUBLE_TAP_SCALE);
  assert.ok(zoomed.x < 0);
  assert.deepEqual(doubleTapView(zoomed, { x: 0, y: 0 }, content, stage), IDENTITY);
  assert.deepEqual(doubleTapView({ scale: 0.5, x: 0, y: 0 }, { x: 0, y: 0 }, content, stage), IDENTITY);
});
