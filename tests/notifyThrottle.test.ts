import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COST_FACTOR, NotifyThrottle, STREAM_NOTIFY_MAX_MS, STREAM_NOTIFY_MS, type ThrottleClock } from '../src/chat/notifyThrottle.ts';

/** a hand-wound clock: timers fire as `advance` passes them, microtasks run on `drain` */
function fakeClock() {
  let now = 1_000;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const micro: Array<() => void> = [];
  const clock: ThrottleClock = {
    now: () => now,
    after: (ms, run) => {
      const id = (nextId += 1);
      timers.set(id, { at: now + ms, run });
      return () => timers.delete(id);
    },
    microtask: (run) => micro.push(run),
  };
  return {
    clock,
    get timers() {
      return timers.size;
    },
    /** time passes; `during` is how long the notification just made took to render */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].run();
      }
      now = end;
    },
    /** the render that follows a notification took `ms` before its microtask ran */
    render(ms: number) {
      now += ms;
      while (micro.length) micro.shift()!();
    },
  };
}

test('the first change after a quiet spell notifies at once; the rest share one trailing notification', () => {
  const fake = fakeClock();
  let heard = 0;
  const throttle = new NotifyThrottle(() => (heard += 1), fake.clock);

  throttle.request();
  assert.equal(heard, 1, 'leading edge');
  fake.render(0);
  for (let i = 0; i < 200; i += 1) throttle.request();
  assert.equal(heard, 1, 'the burst waits for the beat');
  assert.equal(fake.timers, 1, 'one timer however many changes');

  fake.advance(STREAM_NOTIFY_MS);
  assert.equal(heard, 2, 'one trailing notification');
  assert.equal(fake.timers, 0);
});

test('a quiet beat leaves nothing scheduled and the next change leads again', () => {
  const fake = fakeClock();
  let heard = 0;
  const throttle = new NotifyThrottle(() => (heard += 1), fake.clock);
  throttle.request();
  fake.render(0);
  fake.advance(STREAM_NOTIFY_MS * 4);
  assert.equal(heard, 1);
  assert.equal(throttle.pending, false);
  throttle.request();
  assert.equal(heard, 2);
});

test('flush notifies on the spot and takes over the wait in progress', () => {
  const fake = fakeClock();
  let heard = 0;
  const throttle = new NotifyThrottle(() => (heard += 1), fake.clock);
  throttle.request();
  fake.render(0);
  throttle.request();
  assert.equal(throttle.pending, true);
  throttle.flush();
  assert.equal(heard, 2);
  assert.equal(throttle.pending, false);
  fake.advance(STREAM_NOTIFY_MS * 2);
  assert.equal(heard, 2, 'the flushed wait does not fire a second time');
});

test('a flush counts as a beat: the stream waits out the interval after it', () => {
  const fake = fakeClock();
  let heard = 0;
  const throttle = new NotifyThrottle(() => (heard += 1), fake.clock);
  throttle.flush();
  fake.render(0);
  fake.advance(10);
  throttle.request();
  assert.equal(heard, 1);
  fake.advance(STREAM_NOTIFY_MS - 10);
  assert.equal(heard, 2);
});

test('the interval stretches with what a streamed render costs, up to a ceiling, and relaxes again', () => {
  const fake = fakeClock();
  const throttle = new NotifyThrottle(() => undefined, fake.clock);
  assert.equal(throttle.interval, STREAM_NOTIFY_MS);
  /** one streamed beat whose render takes `ms` */
  const beat = (ms: number) => {
    fake.advance(throttle.interval);
    throttle.request();
    fake.render(ms);
  };

  beat(40);
  assert.equal(throttle.interval, 40 * COST_FACTOR, 'a 40 ms render owns a third of the thread at most');

  beat(1_000);
  assert.equal(throttle.interval, STREAM_NOTIFY_MAX_MS);

  // cheap renders halve the remembered cost each time
  for (let i = 0; i < 12; i += 1) beat(1);
  assert.equal(throttle.interval, STREAM_NOTIFY_MS);
});

test('an edge that renders slowly does not stretch the beats of the stream after it', () => {
  const fake = fakeClock();
  let heard = 0;
  const throttle = new NotifyThrottle(() => (heard += 1), fake.clock);
  // a tool finishing mounts its rows once: a slow render, but not one a streamed beat repeats
  throttle.flush();
  fake.render(100);
  assert.equal(throttle.interval, STREAM_NOTIFY_MS);
  // the render took longer than a beat: the first text after it is announced at once, not 250 ms after the edge
  throttle.request();
  assert.equal(heard, 2, 'the first text after it is announced at once');
});

test('cancel drops the pending notification', () => {
  const fake = fakeClock();
  let heard = 0;
  const throttle = new NotifyThrottle(() => (heard += 1), fake.clock);
  throttle.request();
  fake.render(0);
  throttle.request();
  throttle.cancel();
  fake.advance(1_000);
  assert.equal(heard, 1);
  assert.equal(fake.timers, 0);
});
