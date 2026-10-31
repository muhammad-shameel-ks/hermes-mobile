import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceFromBottom, jumpLabel, LiftPadding, messagesBelow, replacedTail, sentMessage, TailFollow, type RowFrame } from '../src/chat/scroll.ts';

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
  follow.dragStart(1000);
  // a token arrives while the finger is down and the list still reads as on the bottom
  follow.scrolled(1000);
  assert.equal(follow.follows, false);
});

test('where the drag comes to rest decides whether following resumes', () => {
  const far = new TailFollow();
  far.dragStart(1000);
  far.scrolled(400);
  far.dragEnd(400);
  far.rest(600, 400);
  assert.equal(far.follows, false);

  // dragged back down to near the bottom: following resumes
  const near = new TailFollow();
  near.dragStart(400);
  near.scrolled(960);
  near.dragEnd(960);
  near.rest(40, 960);
  assert.equal(near.follows, true);
});

test('a reader who drags up to read stops following, however close to the bottom they stop', () => {
  const follow = new TailFollow();
  follow.dragStart(1000);
  follow.dragEnd(960);
  follow.rest(40, 960);
  assert.equal(follow.follows, false);
  // the reply keeps streaming: the distance grows under the reader, nothing re-pins it
  follow.scrolled(960);
  assert.equal(follow.follows, false);

  // a pull up that lets go within a few pixels of the bottom is still the reader leaving
  const close = new TailFollow();
  close.dragStart(1000);
  close.dragEnd(990);
  close.rest(3, 990);
  assert.equal(close.follows, false);

  // a reply that grew during a drag that did not move the list up is not the reader leaving
  const still = new TailFollow();
  still.dragStart(1000);
  still.dragEnd(1000);
  still.rest(40, 1000);
  assert.equal(still.follows, true);
});

test('nothing follows between the finger lifting and its momentum starting', () => {
  // a flick from the bottom: a token landing before momentum begins must not command a scroll,
  // or the command would take the fling away from the reader
  const flick = new TailFollow();
  flick.dragStart(1000);
  flick.dragEnd(1002);
  assert.equal(flick.follows, false);
  flick.flingStart();
  flick.scrolled(700);
  assert.equal(flick.follows, false);
  flick.flingEnd(600, 400);
  assert.equal(flick.follows, false);

  // no momentum came: once the list is seen at rest the release decides
  const lift = new TailFollow();
  lift.dragStart(1000);
  lift.dragEnd(1002);
  assert.equal(lift.rest(0, 1002), true);
  assert.equal(lift.follows, true);
  // a rest seen twice, or with no release before it, changes nothing
  assert.equal(lift.rest(400, 600), false);
  assert.equal(lift.follows, true);

  // Android ends momentum it never began: that is a rest too
  const android = new TailFollow();
  android.dragStart(1000);
  android.dragEnd(1000);
  assert.equal(android.flingEnd(0, 1000), true);
  assert.equal(android.follows, true);
});

test('a fling out of a drag keeps following suspended until it rests', () => {
  const follow = new TailFollow();
  follow.dragStart(1000);
  follow.dragEnd(1002);
  follow.flingStart();
  follow.scrolled(700);
  assert.equal(follow.follows, false);
  follow.flingEnd(900, 100);
  assert.equal(follow.follows, false);

  // an upward drag flung back down onto the bottom follows again
  const back = new TailFollow();
  back.dragStart(1000);
  back.dragEnd(800);
  back.flingStart();
  back.scrolled(1170);
  back.flingEnd(30, 1170);
  assert.equal(back.follows, true);
});

test('a drag that starts while the list is still moving measures its direction from the furthest point reached', () => {
  // a glide (or a follow step issued before the drag reached JS) carries the list on under the finger
  const pulled = new TailFollow();
  pulled.dragStart(900);
  pulled.scrolled(1000);
  pulled.scrolled(960);
  pulled.dragEnd(960);
  pulled.rest(40, 960);
  assert.equal(pulled.follows, false);

  // the same drag that only rode the list down follows on
  const rode = new TailFollow();
  rode.dragStart(900);
  rode.scrolled(1000);
  rode.dragEnd(1000);
  rode.rest(0, 1000);
  assert.equal(rode.follows, true);
});

test('momentum from a commanded scroll is not a fling', () => {
  const follow = new TailFollow();
  // the reader let go near the bottom; the app glides the rest of the way and Android reports momentum for it
  follow.dragStart(900);
  follow.dragEnd(970);
  follow.rest(30, 970);
  assert.equal(follow.follows, true);
  follow.commanded();
  follow.flingStart();
  follow.scrolled(800);
  assert.equal(follow.follows, true);
  follow.flingEnd(200, 800);
  assert.equal(follow.follows, true);

  // with no drag before it at all
  const idle = new TailFollow();
  idle.flingStart();
  assert.equal(idle.follows, true);
});

test('only the reader unpins, and only the reader or the app pins again', () => {
  const follow = new TailFollow();
  // a programmatic or layout-driven move away from the bottom is not the reader leaving
  follow.scrolled(200);
  assert.equal(follow.follows, true);

  follow.dragStart(1000);
  follow.dragEnd(500);
  follow.rest(500, 500);
  assert.equal(follow.follows, false);
  follow.scrolled(300);
  assert.equal(follow.follows, false);
  // a tool row folds and the content shrinks under the reader until the clamped list sits on its bottom
  follow.scrolled(0);
  assert.equal(follow.follows, false);
});

test('the jump pill pins without waiting for the list to arrive, even mid-fling', () => {
  const follow = new TailFollow();
  follow.dragStart(1000);
  follow.dragEnd(200);
  follow.rest(800, 200);
  follow.pin();
  assert.equal(follow.follows, true);

  const flinging = new TailFollow();
  flinging.dragStart(1000);
  flinging.dragEnd(600);
  flinging.flingStart();
  flinging.pin();
  assert.equal(flinging.follows, true);
  // the fling the pill cut short reports its end late: it is no longer the reader's
  flinging.flingEnd(700, 300);
  assert.equal(flinging.follows, true);
});

test('a send lifts the message and nothing follows the reply until the reader scrolls', () => {
  const follow = new TailFollow();
  follow.anchor();
  assert.equal(follow.follows, false);
  // resting on the bottom of the blank space under the lifted message is not the tail
  follow.scrolled(1000);
  assert.equal(follow.follows, false);

  // the reader drags down onto the bottom: following resumes
  follow.dragStart(600);
  follow.scrolled(998);
  follow.dragEnd(998);
  follow.rest(2, 998);
  assert.equal(follow.follows, true);

  // the pill ends the lift too
  const pill = new TailFollow();
  pill.anchor();
  pill.pin();
  assert.equal(pill.follows, true);
});

test('the reply to a send settling ends the lift: a reader left on the bottom follows what comes next', () => {
  const short = new TailFollow();
  short.anchor();
  // the reply is still streaming: nothing ends the lift
  assert.equal(short.replied(0), false);
  assert.equal(short.follows, false);
  short.replyEnded();
  // the settling commit's layout has not been measured yet: still nothing follows, so its growth steps nothing
  assert.equal(short.follows, false);
  assert.equal(short.replied(0), true);
  assert.equal(short.follows, true);
  assert.equal(short.replied(0), false);

  // the settling commit grew the rows past the padded bottom (the last text, the action bar): the reader
  // resting on the lift keeps their message at the top and nothing follows
  const grown = new TailFollow();
  grown.anchor();
  grown.replyEnded();
  grown.replied(48);
  assert.equal(grown.follows, false);

  // the reply outgrew the viewport under the lifted message: the reader is reading, nothing follows
  const long = new TailFollow();
  long.anchor();
  long.replyEnded();
  long.replied(300);
  assert.equal(long.follows, false);

  // a new send before the settled layout is measured keeps its own lift
  const again = new TailFollow();
  again.anchor();
  again.replyEnded();
  again.anchor();
  assert.equal(again.replied(0), false);
  assert.equal(again.follows, false);

  // with no lift to end, a settled reply leaves a reader who scrolled away where they are
  const away = new TailFollow();
  away.anchor();
  away.replyEnded();
  away.dragStart(1000);
  away.dragEnd(500);
  away.rest(500, 500);
  assert.equal(away.replied(0), false);
  assert.equal(away.follows, false);
});

test('a send is the reader’s own user message appended after the tail last seen, its reply possibly already started', () => {
  const thread = [
    { id: 'u1', role: 'user' as const },
    { id: 'a1', role: 'assistant' as const },
  ];
  const sent = { id: 'u2', role: 'user' as const, sent: true as const };
  assert.equal(sentMessage([...thread, sent], 'a1'), 'u2');
  assert.equal(sentMessage([...thread, sent, { id: 'a2', role: 'assistant' }], 'a1'), 'u2');
  // the first message of an empty chat
  assert.equal(sentMessage([{ id: 'u1', role: 'user', sent: true }], null), 'u1');
  // nothing new, or only a reply growing
  assert.equal(sentMessage(thread, 'a1'), null);
  assert.equal(sentMessage([...thread, { id: 'a2', role: 'assistant' }], 'a1'), null);
  // another chat, or a reload that replaced the ids, is not a send
  assert.equal(sentMessage([{ id: 'x1', role: 'assistant' }, { id: 'x2', role: 'user' }], 'a1'), null);
  assert.equal(sentMessage(thread, null), null);
});

test('a reload that brings another device’s turn in right after the old tail is not a send', () => {
  const thread = [
    { id: 'u1', role: 'user' as const },
    { id: 'a1', role: 'assistant' as const },
  ];
  assert.equal(sentMessage([...thread, { id: 'u2', role: 'user' }, { id: 'a2', role: 'assistant' }], 'a1'), null);
  // a turn still running elsewhere replays its prompt at the tail
  assert.equal(sentMessage([...thread, { id: 'live-1', role: 'user' }, { id: 'live-2', role: 'assistant' }], 'a1'), null);
  // a warm tail painting one user message into an empty chat
  assert.equal(sentMessage([{ id: 'u1', role: 'user' }], null), null);
});

test('the tail is replaced when the id last seen there is gone from the newest messages', () => {
  const thread = [{ id: 'u1' }, { id: 'a1' }];
  assert.equal(replacedTail(thread, 'a1'), false);
  assert.equal(replacedTail([...thread, { id: 'u2' }, { id: 'a2' }], 'a1'), false);
  // a reload swapped the live ids for the stored rows
  assert.equal(replacedTail([{ id: 'row-1' }, { id: 'row-2' }], 'live-7'), true);
  // nothing was on screen before, or nothing is now
  assert.equal(replacedTail(thread, null), false);
  assert.equal(replacedTail([], 'a1'), false);
});

test('the lift padding only ever shrinks, to where the reader rests, and goes once the rows fill it', () => {
  const pad = new LiftPadding();
  assert.equal(pad.minHeight(800), null);
  pad.hold(1000);
  assert.equal(pad.minHeight(800), 1800);
  // nothing until the viewport is measured
  assert.equal(pad.minHeight(0), null);
  // the reader rests below the lifted offset (the reply outgrew it): the padding is not raised
  pad.rest(1200);
  assert.equal(pad.minHeight(800), 1800);
  // the reader scrolls up to read and rests: the padding holds just that offset, never more
  pad.rest(700);
  assert.equal(pad.minHeight(800), 1500);
  pad.rest(900);
  assert.equal(pad.minHeight(800), 1500);
  // a keyboard resizes the viewport: the held offset stays reachable
  assert.equal(pad.minHeight(500), 1200);
  // rows that end short of the padded bottom still need it; rows that reach it hold the offset themselves
  pad.rowsReach(1499, 800);
  assert.equal(pad.minHeight(800), 1500);
  pad.rowsReach(1500, 800);
  assert.equal(pad.minHeight(800), null);
  // once gone it never comes back on its own: a later rest or a resize holds nothing
  pad.rest(100);
  assert.equal(pad.minHeight(900), null);

  const top = new LiftPadding();
  top.hold(-12);
  assert.equal(top.minHeight(800), 800);
  top.release();
  assert.equal(top.minHeight(800), null);
});
