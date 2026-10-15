import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pinnedPrompt, pinOffset, STICKY_TOP, type StickyRow } from '../src/chat/stickyPrompt.ts';
import type { RowFrame } from '../src/chat/scroll.ts';

const rows: StickyRow[] = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'a2', role: 'assistant' },
];
const frames = new Map<string, RowFrame>([
  ['u1', { y: 0, height: 50 }],
  ['a1', { y: 50, height: 400 }],
  ['u2', { y: 450, height: 50 }],
  ['a2', { y: 500, height: 600 }],
]);
const PAD = 6;
const END = 1100;

test('nothing is pinned while the first prompt is still in view', () => {
  assert.equal(pinnedPrompt(rows, frames, 0, PAD, END), null);
  assert.equal(pinnedPrompt(rows, frames, 1, PAD, END), null);
});

test('a prompt pins once its bubble has scrolled above the pin line', () => {
  const pin = pinnedPrompt(rows, frames, 40, PAD, END);
  assert.deepEqual(pin, { id: 'u1', index: 0, turnEnd: 456 });
});

test('the later prompt takes over when its own bubble reaches the pin line', () => {
  assert.equal(pinnedPrompt(rows, frames, 440, PAD, END)?.id, 'u1');
  assert.equal(pinnedPrompt(rows, frames, 455, PAD, END)?.id, 'u2');
  assert.equal(pinnedPrompt(rows, frames, 455, PAD, END)?.turnEnd, END);
});

test('the pinned bubble holds still until the turn ends within its height, then rides up with it', () => {
  const pin = { id: 'u1', index: 0, turnEnd: 456 };
  const height = 60;
  assert.equal(pinOffset(pin, 100, height), 0);
  assert.equal(pinOffset(pin, 392, height), 0);
  assert.equal(pinOffset(pin, 400, height), -(400 + STICKY_TOP + height - 456));
  assert.ok(pinOffset(pin, 440, height) < pinOffset(pin, 420, height));
});

test('the last turn pins until the end of the list passes', () => {
  const pin = pinnedPrompt(rows, frames, 600, PAD, END)!;
  assert.equal(pin.id, 'u2');
  assert.equal(pinOffset(pin, 600, 60), 0);
});

test('rows the list has not laid out are skipped rather than pinning the wrong prompt', () => {
  const partial = new Map(frames);
  partial.delete('u2');
  assert.equal(pinnedPrompt(rows, partial, 600, PAD, END)?.id, 'u1');
  assert.equal(pinnedPrompt(rows, new Map(), 600, PAD, END), null);
});

test('system notices between turns neither pin nor end a turn', () => {
  const withNotice: StickyRow[] = [rows[0], rows[1], { id: 'n', role: 'system' }, rows[2], rows[3]];
  const f = new Map(frames);
  f.set('n', { y: 430, height: 20 });
  assert.equal(pinnedPrompt(withNotice, f, 40, PAD, END)?.turnEnd, 456);
});
