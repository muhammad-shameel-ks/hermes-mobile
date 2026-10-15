import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLoopRegistry, loopKey, type LoopSpec } from '../src/ui/loops.ts';

function registry() {
  const log: string[] = [];
  let made = 0;
  const loops = createLoopRegistry<{ id: number }>({
    create: () => ({ id: (made += 1) }),
    start: (value, spec) => log.push(`start ${value.id} ${loopKey(spec)}`),
    stop: (value) => log.push(`stop ${value.id}`),
  });
  return { loops, log };
}

const SHIMMER: LoopSpec = { durationMs: 1900 };
const STEPS: LoopSpec = { durationMs: 1700, steps: 17 };

test('one timeline serves every consumer of a spec, and it runs only while one holds it', () => {
  const { loops, log } = registry();
  assert.equal(loops.value(SHIMMER), loops.value({ durationMs: 1900 }));
  assert.notEqual(loops.value(SHIMMER), loops.value(STEPS));
  assert.deepEqual(log, []);

  const a = loops.acquire(SHIMMER);
  const b = loops.acquire(SHIMMER);
  assert.deepEqual(log, ['start 1 1900:0']);
  a();
  assert.deepEqual(log, ['start 1 1900:0']);
  b();
  assert.deepEqual(log, ['start 1 1900:0', 'stop 1']);
  assert.equal(loops.running, 0);
});

test('releasing twice does not steal another consumer\'s hold', () => {
  const { loops, log } = registry();
  const a = loops.acquire(SHIMMER);
  const b = loops.acquire(SHIMMER);
  a();
  a();
  assert.equal(loops.running, 1);
  b();
  assert.equal(loops.running, 0);
  assert.equal(log.filter((line) => line.startsWith('stop')).length, 1);
});

test('the background stops every timeline and the foreground restarts the held ones', () => {
  const { loops, log } = registry();
  loops.value(STEPS);
  const release = loops.acquire(SHIMMER);
  loops.setForeground(false);
  assert.deepEqual(log, ['start 2 1900:0', 'stop 2']);
  // a consumer arriving while backgrounded waits for the foreground
  const late = loops.acquire(STEPS);
  assert.equal(loops.running, 0);
  loops.setForeground(true);
  assert.equal(loops.running, 2);
  loops.setForeground(true);
  assert.equal(loops.running, 2);
  release();
  late();
  assert.equal(loops.running, 0);
});

test('holds stack and freeze the timelines until the last is released', () => {
  const { loops } = registry();
  const release = loops.acquire(SHIMMER);
  const first = loops.hold();
  const second = loops.hold();
  assert.equal(loops.running, 0);
  first();
  first();
  assert.equal(loops.running, 0);
  second();
  assert.equal(loops.running, 1);
  release();
});
