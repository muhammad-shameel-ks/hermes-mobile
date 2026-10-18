import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceFromBottom, jumpLabel, messagesBelow, TailFollow, type RowFrame } from '../src/chat/scroll.ts';

const ids = ['a', 'b', 'c', 'd'];
const frames = new Map<string, RowFrame>([
  ['a', { y: 0, height: 100 }],
  ['b', { y: 100, height: 100 }],
  ['c', { y: 200, height: 300 }],
  ['d', { y: 500, height: 100 }],
]);

test('nothing is below when the viewport reaches the last row', () => {
  assert.equal(messagesBelow(ids, frames, 600), 0);
  assert.equal(messagesBelow(ids, frames, 900), 0);
});

test('a row straddling the fold counts, rows above it do not', () => {
  assert.equal(messagesBelow(ids, frames, 550), 1);
  assert.equal(messagesBelow(ids, frames, 300), 2);
  assert.equal(messagesBelow(ids, frames, 150), 3);
});

test('a row ending within a pixel of the fold reads as on screen', () => {
  assert.equal(messagesBelow(ids, frames, 499.5), 1);
});

test('unmeasured rows at the tail count as below', () => {
  const partial = new Map(frames);
  partial.delete('d');
  assert.equal(messagesBelow(ids, partial, 500), 1);
  assert.equal(messagesBelow([...ids, 'e'], partial, 300), 3);
});

test('distance from bottom never goes negative', () => {
  assert.equal(distanceFromBottom(0, 800, 400), 0);
  assert.equal(distanceFromBottom(100, 500, 1000), 400);
});

test('the label carries a singular or plural count, or none', () => {
  assert.equal(jumpLabel(0), 'Scroll to bottom');
  assert.equal(jumpLabel(1), 'Scroll to bottom · 1 message');
  assert.equal(jumpLabel(4), 'Scroll to bottom · 4 messages');
});

test('a drag suspends following before its first scroll echo lands', () => {
  const follow = new TailFollow();
  assert.equal(follow.follows, true);
  follow.dragStart();
  // a token arrives while the finger is down and the list still reads as on the bottom
  follow.scrolled(0);
  assert.equal(follow.follows, false);
});

test('where the drag comes to rest decides whether following resumes', () => {
  const far = new TailFollow();
  far.dragStart();
  far.scrolled(600);
  far.dragEnd(600);
  assert.equal(far.follows, false);

  const near = new TailFollow();
  near.dragStart();
  near.scrolled(40);
  near.dragEnd(40);
  assert.equal(near.follows, true);
});

test('a fling out of a drag keeps following suspended until it rests', () => {
  const follow = new TailFollow();
  follow.dragStart();
  follow.dragEnd(2);
  follow.flingStart();
  follow.scrolled(300);
  assert.equal(follow.follows, false);
  follow.flingEnd(900);
  assert.equal(follow.follows, false);
});

test('momentum from a commanded scroll is not a fling', () => {
  const follow = new TailFollow();
  // the reader let go near the bottom; the app glides the rest of the way and Android reports momentum for it
  follow.dragStart();
  follow.dragEnd(30);
  follow.commanded();
  follow.flingStart();
  follow.scrolled(200);
  assert.equal(follow.follows, true);
  follow.flingEnd(200);
  assert.equal(follow.follows, true);

  // with no drag before it at all
  const idle = new TailFollow();
  idle.flingStart();
  assert.equal(idle.follows, true);
});

test('only the reader unpins; any scroll that reaches the bottom pins again', () => {
  const follow = new TailFollow();
  // a programmatic or layout-driven move away from the bottom is not the reader leaving
  follow.scrolled(200);
  assert.equal(follow.follows, true);

  follow.dragStart();
  follow.dragEnd(500);
  assert.equal(follow.follows, false);
  follow.scrolled(300);
  assert.equal(follow.follows, false);
  // a send or thread switch carries the list to the bottom
  follow.scrolled(0);
  assert.equal(follow.follows, true);
});

test('the jump pill pins without waiting for the list to arrive', () => {
  const follow = new TailFollow();
  follow.dragStart();
  follow.dragEnd(800);
  follow.pin();
  assert.equal(follow.follows, true);
});
