/**
 * The transcript's scroll rules as plain arithmetic: whether the list follows a
 * streaming reply, when the floating jump-to-bottom control shows and how many
 * messages it counts (desktop app/chat/scroll-to-bottom-button and
 * thread/use-messages-below).
 */

import type { Message } from './transcript.ts';

export type RowFrame = { y: number; height: number };

/** farther than this from the bottom edge and the reader has left the tail */
export const JUMP_SHOW_DISTANCE = 72;
/** within this of the bottom edge the list is on the tail */
export const PINNED_DISTANCE = 4;

export function distanceFromBottom(scrollY: number, viewportHeight: number, contentHeight: number): number {
  return Math.max(0, contentHeight - scrollY - viewportHeight);
}

/**
 * Whether new content scrolls the list to its bottom. Only the reader's own gesture leaves the
 * tail: while a finger is down, from the moment it lifts until the list is seen at rest or flinging,
 * and while its fling is in flight, the list never follows, so neither a token that lands before the
 * gesture's first scroll echo nor one that lands between the finger lifting and momentum starting
 * can command the list out from under the reader. Where the gesture comes to rest and which way it
 * last went decide whether following resumes: a gesture that ended moving the list up stops
 * following wherever it rests (the reader stopped to read), one that ended moving it down to within
 * `JUMP_SHOW_DISTANCE` of the bottom, where the jump pill stays hidden, follows again. The pill pins;
 * a scroll the reader did not drive (a follow step, content shrinking under the list) never pins or
 * unpins.
 *
 * Direction compares scroll offsets, not distances from the bottom, because a streaming reply grows
 * the distance under a finger that has not moved. It is measured from the furthest-down offset the
 * gesture's echoes reached, not from where it started: a glide in flight or a follow step the app
 * issued before the drag reached JS can carry the list on under the finger, and pulling back from
 * there is still the reader going up. Offsets are clamped to the scrollable range by the caller, so
 * an overscroll bounce is no direction.
 *
 * Android reports momentum for a commanded animated scroll too, so momentum counts as a fling
 * only when it starts straight out of a drag, before the list is commanded anywhere.
 */
export class TailFollow {
  private pinned = true;
  /** a finger is down, has lifted with its momentum not yet known, or its fling is in flight */
  private gesture = false;
  /** the finger lifted and the list has not been seen at rest or flinging since */
  private released = false;
  private afterDrag = false;
  private flinging = false;
  /** the furthest-down offset the reader's gesture has carried the list to */
  private peakY = 0;
  /** a send lifted the reader's message to the top: the reply fills in below it and nothing follows */
  private anchored = false;
  /** the lifted reply finished; the lift ends once its settled layout is measured */
  private replyDone = false;

  dragStart(scrollY: number): void {
    this.gesture = true;
    this.released = false;
    this.afterDrag = false;
    this.flinging = false;
    this.anchored = false;
    this.peakY = scrollY;
  }

  /** the finger lifted at offset `scrollY`; a fling may follow, so nothing follows until `rest` or `flingStart` */
  dragEnd(scrollY: number): void {
    this.gesture = true;
    this.released = true;
    this.afterDrag = true;
    this.reach(scrollY);
  }

  /** the list was seen at rest `distance` from the bottom at `scrollY` after a release no momentum followed; false when there was none to settle */
  rest(distance: number, scrollY: number): boolean {
    if (!this.released) return false;
    this.settle(distance, scrollY);
    return true;
  }

  flingStart(): void {
    if (!this.afterDrag) return;
    this.afterDrag = false;
    this.released = false;
    this.flinging = true;
    this.gesture = true;
  }

  /** momentum came to rest `distance` from the bottom at offset `scrollY` (Android also ends momentum it never began); false when it was not the reader's */
  flingEnd(distance: number, scrollY: number): boolean {
    if (!this.flinging && !this.released) return false;
    this.flinging = false;
    this.settle(distance, scrollY);
    return true;
  }

  /** the app is about to scroll the list itself; momentum from here on is not the reader's */
  commanded(): void {
    this.afterDrag = false;
  }

  /** any scroll echo at offset `scrollY`; during a gesture it may carry the list further down */
  scrolled(scrollY: number): void {
    if (this.gesture) this.reach(scrollY);
  }

  /** the list is told to sit on the bottom (the jump pill); the app takes the list over from any gesture in flight */
  pin(): void {
    this.pinned = true;
    this.anchored = false;
    this.gesture = false;
    this.released = false;
    this.flinging = false;
    this.afterDrag = false;
  }

  /** a send lifts the reader's message to the top; the reply streams in below it until the reader scrolls */
  anchor(): void {
    this.pinned = false;
    this.anchored = true;
    this.replyDone = false;
  }

  /**
   * The reply to a send finished. The commit that settles it can still grow the rows (the last text, the
   * action bar) after this is heard, so the lift holds, following nothing, until `replied` measures it.
   */
  replyEnded(): void {
    if (this.anchored) this.replyDone = true;
  }

  /**
   * The settled reply measured `distance` from the bottom of where the lift rests: the lift ends. A
   * reader still on the bottom follows what comes next (a reload re-laying the reply, the next turn);
   * one the reply outgrew is reading and stays put. False when there was no finished lift to end.
   */
  replied(distance: number): boolean {
    if (!this.anchored || !this.replyDone || this.gesture) return false;
    this.anchored = false;
    this.replyDone = false;
    this.pinned = distance <= PINNED_DISTANCE;
    return true;
  }

  reset(): void {
    this.pinned = true;
    this.gesture = false;
    this.released = false;
    this.afterDrag = false;
    this.flinging = false;
    this.anchored = false;
    this.replyDone = false;
    this.peakY = 0;
  }

  /** whether growing content should carry the list down with it */
  get follows(): boolean {
    return this.pinned && !this.gesture;
  }

  private reach(scrollY: number): void {
    if (scrollY > this.peakY) this.peakY = scrollY;
  }

  private settle(distance: number, scrollY: number): void {
    this.gesture = false;
    this.released = false;
    this.reach(scrollY);
    const upward = scrollY < this.peakY - PINNED_DISTANCE;
    this.pinned = !upward && distance <= JUMP_SHOW_DISTANCE;
  }
}

/**
 * The Prompt lift's padding: the content is held at least `top + viewport` tall so the reader's
 * message can rest at the top of the viewport while the reply streams into the space under it. It
 * only ever shrinks, and only below the viewport's bottom edge, so nothing on screen moves: down to
 * where the reader comes to rest above the lifted offset, and away once the rows themselves reach
 * the padded bottom. A finished reply then never leaves blank space to scroll into below it.
 */
export class LiftPadding {
  /** the offset the padding keeps reachable, or null when nothing is held */
  private top: number | null = null;

  hold(top: number): void {
    this.top = Math.max(0, top);
  }

  /** the reader's scroll came to rest at `scrollY`: the padding holds no more than keeps that offset */
  rest(scrollY: number): void {
    if (this.top !== null && scrollY < this.top) this.top = Math.max(0, scrollY);
  }

  /** the newest row ends at `bottom`: once it reaches the padded bottom the rows hold the offset themselves */
  rowsReach(bottom: number, viewport: number): void {
    if (this.top !== null && viewport > 0 && bottom >= this.top + viewport) this.top = null;
  }

  release(): void {
    this.top = null;
  }

  /** the content's minimum height under a viewport `viewport` tall, or null when nothing is held */
  minHeight(viewport: number): number | null {
    return this.top === null || viewport === 0 ? null : this.top + viewport;
  }
}

/** how far back from the tail a send is looked for: its reply (and a notice) may land in the same look */
const SENT_LOOKBACK = 4;

/**
 * The reader's message a send just appended, or null. `previousTail` is the id the tail had at the
 * last look: the send is a user message this device sent (`sent`) among the messages after it, with
 * that tail still right before it (a pure append to the thread on screen, not a chat switch or a
 * reload that replaced the ids). A user message a reload brings in, even right after the old tail,
 * is another device's or a replay, never the reader's send. In a chat that was empty the send is the
 * only message.
 */
export function sentMessage(messages: readonly Pick<Message, 'id' | 'role' | 'sent'>[], previousTail: string | null): string | null {
  if (previousTail === null) return messages.length === 1 && messages[0].sent === true ? messages[0].id : null;
  const stop = Math.max(1, messages.length - SENT_LOOKBACK);
  for (let index = messages.length - 1; index >= stop; index--) {
    const message = messages[index];
    if (message.id === previousTail) return null;
    if (message.role === 'user') return message.sent === true && messages[index - 1].id === previousTail ? message.id : null;
  }
  return null;
}

/**
 * Whether the messages on screen were replaced rather than grown: the id the tail had at the last
 * look is gone from the newest messages (a reload swapped live ids for stored rows). A streamed beat
 * finds the old tail at the end, so this is O(1) per token.
 */
export function replacedTail(messages: readonly Pick<Message, 'id'>[], previousTail: string | null): boolean {
  if (previousTail === null || messages.length === 0) return false;
  const stop = Math.max(0, messages.length - 1 - SENT_LOOKBACK);
  for (let index = messages.length - 1; index >= stop; index--) if (messages[index].id === previousTail) return false;
  return true;
}

/**
 * Messages whose bottom edge sits below the viewport's, a straddler included.
 * Walks up from the newest row and stops at the first measured row that ends
 * inside the viewport; an unmeasured row at the tail is one the list has not
 * laid out yet, so it counts as below.
 */
export function messagesBelow(ids: readonly string[], frames: ReadonlyMap<string, RowFrame>, viewportBottom: number): number {
  let count = 0;
  for (let index = ids.length - 1; index >= 0; index--) {
    const frame = frames.get(ids[index]);
    if (frame && frame.y + frame.height <= viewportBottom + 1) break;
    count++;
  }
  return count;
}

export const messageCountLabel = (count: number) => `${count} ${count === 1 ? 'message' : 'messages'}`;

export const jumpLabel = (count: number) => (count > 0 ? `Scroll to bottom · ${messageCountLabel(count)}` : 'Scroll to bottom');
