import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DECODE_HOLD_TICKS, DECODE_START, decodeTick, scrambled } from '../src/ui/decode.ts';

test('scrambling keeps spaces and the resolved head, and draws from the even-weight charset', () => {
  const out = scrambled('AB CD', 2, () => 0);
  assert.equal(out, 'AB //');
  assert.equal(scrambled('AB CD', 5, () => 0.99), 'AB CD');
});

test('half a character resolves per tick', () => {
  let state = DECODE_START;
  const resolved: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const tick = decodeTick(state, 'WORD', false, () => 0);
    state = tick.state;
    resolved.push(Math.floor(state.resolved));
  }
  assert.deepEqual(resolved, [0, 1, 1, 2]);
});

test('a resolved word holds, then stops once, or replays when looping', () => {
  const resolved = { resolved: 4, hold: 0 };
  let state = resolved;
  for (let i = 0; i < DECODE_HOLD_TICKS; i += 1) {
    const tick = decodeTick(state, 'WORD', false);
    assert.equal(tick.stop, false);
    assert.equal(tick.text, 'WORD');
    state = tick.state;
  }
  assert.equal(decodeTick(state, 'WORD', false).stop, true);
  const replay = decodeTick(state, 'WORD', true);
  assert.equal(replay.stop, false);
  assert.deepEqual(replay.state, DECODE_START);
});
