import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RING_COUNT, shimmerCentre, shimmerProfile, shimmerRings, shimmerSweepShare, shimmerTiming } from '../src/ui/shimmer.ts';

/** the stacked coverage a ring set paints at `distance` (a fraction of the spread) from the band's centre */
function coverage(spread: number, peak: number, distance: number, count = RING_COUNT): number {
  return shimmerRings(spread, peak, count).reduce((covered, ring) => (distance * spread < ring.halfWidth ? covered + (1 - covered) * ring.opacity : covered), 0);
}

function error(count: number, peak = 1) {
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let d = 0; d <= 0.5; d += 0.0005) {
    const diff = Math.abs(coverage(1, peak, d, count) - peak * shimmerProfile(d));
    max = Math.max(max, diff);
    sum += diff * diff;
    n += 1;
  }
  return { max, rms: Math.sqrt(sum / n) };
}

test('the stack follows the 17-stop gradient at least as closely as the eight-ring one it replaced', () => {
  // measured on the retired eight-ring stack (one ring per stop): max 0.085, rms 0.039
  const now = error(RING_COUNT);
  assert.ok(now.max <= 0.085, `max ${now.max}`);
  assert.ok(now.rms <= 0.04, `rms ${now.rms}`);
  // the error scales with the peak, so the light highlight is no worse
  assert.ok(error(RING_COUNT, 0.8).max <= 0.085 * 0.8);
});

test('the centre is the full highlight and nothing is painted past the outermost ring', () => {
  assert.ok(Math.abs(coverage(100, 1, 0) - 1) < 1e-9);
  assert.ok(Math.abs(coverage(100, 0.8, 0) - 0.8) < 1e-9);
  assert.equal(coverage(100, 1, 0.5), 0);
  const rings = shimmerRings(100);
  assert.equal(rings.length, RING_COUNT);
  assert.ok(rings.every((ring) => ring.opacity > 0 && ring.opacity <= 1));
  assert.ok(rings.every((ring, i) => i === 0 || ring.halfWidth < rings[i - 1].halfWidth));
});

test('windows scale with the spread', () => {
  const small = shimmerRings(100);
  const big = shimmerRings(200);
  small.forEach((ring, i) => assert.ok(Math.abs(big[i].halfWidth - ring.halfWidth * 2) < 1e-9));
});

test('one frame transform and one counter transform keep every copy on the glyphs', () => {
  const timing = shimmerTiming(12);
  const rings = shimmerRings(timing.spread, 1);
  const anchor = rings[0].halfWidth;
  const share = shimmerSweepShare(timing);
  for (const phase of [0, 0.2, 0.5, 0.9, 0.999]) {
    const centre = shimmerCentre(phase, share, -timing.spread / 2, 240 + timing.spread / 2);
    for (const ring of rings) {
      const inset = anchor - ring.halfWidth;
      // window: static inset + the shared frame translate; copy: -inset + the shared counter translate
      const windowLeft = inset + (centre - anchor);
      const copyLeft = windowLeft + (-inset + (anchor - centre));
      assert.ok(Math.abs(windowLeft - (centre - ring.halfWidth)) < 1e-9);
      assert.ok(Math.abs(copyLeft) < 1e-9, 'the highlight copy sits where the base text does');
    }
  }
});

test('the sweep crosses the text, holds for the pause, then starts over', () => {
  const timing = shimmerTiming(12);
  const share = shimmerSweepShare(timing);
  assert.ok(Math.abs(share - timing.sweepMs / (timing.sweepMs + timing.delayMs)) < 1e-12);
  assert.equal(shimmerCentre(0, share, -50, 300), -50);
  assert.equal(shimmerCentre(share / 2, share, -50, 300), 125);
  assert.equal(shimmerCentre(share, share, -50, 300), 300);
  assert.equal(shimmerCentre(0.999, share, -50, 300), 300);
});
