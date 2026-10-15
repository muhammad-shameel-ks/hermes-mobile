import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURVES, GLYPH_SPINNERS, glyphStrip, PATH_STEPS } from '../src/ui/loaders/curves.ts';
import { loaderFrame, type LoaderKind } from '../src/ui/loaders/frame.ts';
import { createPulseClock, PULSE_PERIOD_MS } from '../src/ui/loaders/pulse.ts';

const numbers = (path: string) => (path.match(/-?\d+\.\d+/g) ?? []).map(Number);

test('the curve tables are the desktop literals', () => {
  assert.deepEqual(CURVES['rose-curve'], {
    durationMs: 5400,
    particleCount: 78,
    pulseDurationMs: 4600,
    rotate: true,
    rotationDurationMs: 28000,
    strokeWidth: 4.5,
    trailSpan: 0.32,
  });
  assert.equal(CURVES['lemniscate-bloom'].particleCount, 70);
  assert.equal(CURVES['lemniscate-bloom'].rotate, false);
  assert.equal(PATH_STEPS, 240);
});

test('a frame emits one curve of pathSteps + 1 points and one disc per particle', () => {
  for (const kind of Object.keys(CURVES) as LoaderKind[]) {
    const { curve, trail } = loaderFrame(kind, CURVES[kind], 1234, 0.3, 1, PATH_STEPS);
    assert.equal(curve.split(/(?=[ML] )/).length, PATH_STEPS + 1);
    assert.ok(curve.startsWith('M '));
    assert.equal((trail.match(/M /g) ?? []).length, CURVES[kind].particleCount);
    for (const value of numbers(curve)) assert.ok(value >= 0 && value <= 100, `${kind} ${value}`);
  }
});

test('pathSteps and strokeScale shape the frame', () => {
  const coarse = loaderFrame('rose-curve', CURVES['rose-curve'], 0, 0, 1, 220);
  assert.equal(coarse.curve.split(/(?=[ML] )/).length, 221);
  const thin = loaderFrame('rose-curve', CURVES['rose-curve'], 0, 0, 0.72, 220);
  const radius = (frame: string) => Number(/a (\d+\.\d+)/.exec(frame)![1]);
  // the head disc is the largest: (0.9 + 2.7) * strokeScale
  assert.equal(radius(coarse.trail), 3.6);
  assert.equal(radius(thin.trail), 2.592);
});

test('the rose curve closes on itself and pulses with the detail scale', () => {
  const closed = loaderFrame('rose-curve', { ...CURVES['rose-curve'], rotate: false }, 0, 0, 1, PATH_STEPS).curve.split(/(?=[ML] )/);
  assert.equal(closed[0].slice(1).trim(), closed[PATH_STEPS].slice(1).trim());
  // the pulse period is 4600ms: the frame repeats once the rotation is held still
  const still = { ...CURVES['rose-curve'], rotate: false, durationMs: 4600 };
  assert.equal(loaderFrame('rose-curve', still, 0, 0, 1, 40).curve, loaderFrame('rose-curve', still, 4600, 0, 1, 40).curve);
  assert.notEqual(loaderFrame('rose-curve', still, 0, 0, 1, 40).curve, loaderFrame('rose-curve', still, 1150, 0, 1, 40).curve);
});

test('the lemniscate stays still while the rose rotates', () => {
  const lemniscate = CURVES['lemniscate-bloom'];
  // 5000ms is a whole pulse, so only rotation could change the curve
  const a = loaderFrame('lemniscate-bloom', lemniscate, 0, 0, 1, 60).curve;
  const b = loaderFrame('lemniscate-bloom', lemniscate, 5000, 0, 1, 60).curve;
  assert.equal(a, b);
  const rose = CURVES['rose-curve'];
  assert.notEqual(loaderFrame('rose-curve', rose, 0, 0, 1, 60).curve, loaderFrame('rose-curve', rose, 4600, 0, 1, 60).curve);
});

test('the glyph strip repeats the first frame so the wrap shows no blank cell', () => {
  for (const name of ['braille', 'breathe'] as const) {
    const strip = glyphStrip(name);
    assert.equal(strip.length, GLYPH_SPINNERS[name].frames.length + 1);
    assert.equal(strip[strip.length - 1], strip[0]);
  }
  assert.equal(GLYPH_SPINNERS.braille.frames.length, 10);
  assert.equal(GLYPH_SPINNERS.braille.interval, 80);
  assert.equal(GLYPH_SPINNERS.breathe.frames.length, 17);
  assert.equal(GLYPH_SPINNERS.breathe.interval, 100);
});

function fakeTimers() {
  const pending = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  let next = 1;
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        pending.set(next, { fn, at: now + ms });
        return next++;
      },
      clear: (handle: unknown) => void pending.delete(handle as number),
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get pending() {
      return pending.size;
    },
  };
}

test('the pulse clock plays the first subscriber at once and then on one shared 5 s beat', () => {
  const fake = fakeTimers();
  const clock = createPulseClock(fake.timers);
  const plays: string[] = [];
  const first = clock.subscribe({ play: () => plays.push('a'), cancel: () => {} });
  assert.deepEqual(plays, ['a']);
  fake.advance(2000);
  const second = clock.subscribe({ play: () => plays.push('b'), cancel: () => {} });
  assert.deepEqual(plays, ['a'], 'a later joiner waits for the aligned beat');
  fake.advance(PULSE_PERIOD_MS - 2000);
  assert.deepEqual(plays, ['a', 'a', 'b']);
  first();
  second();
  assert.equal(fake.pending, 0, 'the last unsubscribe stops the timer');
});

test('the pulse clock sleeps while paused and beats again on resume', () => {
  const fake = fakeTimers();
  const clock = createPulseClock(fake.timers);
  const log: string[] = [];
  clock.subscribe({ play: () => log.push('play'), cancel: () => log.push('cancel') });
  clock.setPaused(true);
  assert.deepEqual(log, ['play', 'cancel']);
  assert.equal(fake.pending, 0);
  fake.advance(20_000);
  assert.deepEqual(log, ['play', 'cancel']);
  clock.setPaused(false);
  assert.deepEqual(log, ['play', 'cancel', 'play']);
  assert.equal(fake.pending, 1);
});
