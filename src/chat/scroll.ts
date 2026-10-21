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
 * tail: while a finger is down or its fling is in flight the list never follows, so a token that
 * lands before the gesture's first scroll echo cannot pull the reader back down. Where the gesture
 * comes to rest and which way it went decide whether following resumes: a gesture that carried the
 * list up stops following wherever it rests (the reader stopped to read), one that carried it down
 * to within `JUMP_SHOW_DISTANCE` of the bottom, where the jump pill stays hidden, follows again. Any
 * scroll that reaches the bottom (a send, the pill, a thread switch) pins again; a scroll the reader
 * did not drive never unpins.
 *
 * Direction compares scroll offsets, not distances from the bottom, because a streaming reply grows
 * the distance under a finger that has not moved.
 *
 * Android reports momentum for a commanded animated scroll too, so momentum counts as a fling
 * only when it starts straight out of a drag, before the list is commanded anywhere.
 */
export class TailFollow {
  private pinned = true;
  private gesture = false;
  private afterDrag = false;
  private flinging = false;
  /** the scroll offset the reader's gesture started from */
  private startY = 0;
  /** a send lifted the reader's message to the top: the reply fills in below it and nothing follows */
  private anchored = false;

  dragStart(scrollY: number): void {
    this.gesture = true;
    this.afterDrag = false;
    this.flinging = false;
    this.anchored = false;
    this.startY = scrollY;
  }

  /** the finger lifted `distance` from the bottom at offset `scrollY`; a fling may follow */
  dragEnd(distance: number, scrollY: number): void {
    this.settle(distance, scrollY);
    this.afterDrag = true;
  }

  flingStart(): void {
    if (!this.afterDrag) return;
    this.afterDrag = false;
    this.flinging = true;
    this.gesture = true;
  }

  /** momentum came to rest `distance` from the bottom at offset `scrollY` */
  flingEnd(distance: number, scrollY: number): void {
    if (!this.flinging) return;
    this.flinging = false;
    this.settle(distance, scrollY);
  }

  /** the app is about to scroll the list itself; momentum from here on is not the reader's */
  commanded(): void {
    this.afterDrag = false;
  }

  /** any scroll echo, `distance` from the bottom; while anchored the list rests on the bottom of a blank space, which is not the tail */
  scrolled(distance: number): void {
    if (distance <= PINNED_DISTANCE) this.pinned = !this.anchored;
    else if (this.gesture) this.pinned = false;
  }

  /** the list is told to sit on the bottom (the jump pill) */
  pin(): void {
    this.pinned = true;
    this.anchored = false;
  }

  /** a send lifts the reader's message to the top; the reply streams in below it until the reader scrolls */
  anchor(): void {
    this.pinned = false;
    this.anchored = true;
  }

  reset(): void {
    this.pinned = true;
    this.gesture = false;
    this.afterDrag = false;
    this.flinging = false;
    this.anchored = false;
    this.startY = 0;
  }

  /** whether growing content should carry the list down with it */
  get follows(): boolean {
    return this.pinned && !this.gesture;
  }

  private settle(distance: number, scrollY: number): void {
    this.gesture = false;
    const upward = scrollY < this.startY - PINNED_DISTANCE;
    this.pinned = distance <= PINNED_DISTANCE || (!upward && distance <= JUMP_SHOW_DISTANCE);
  }
}

/** how far back from the tail a send is looked for: its reply (and a notice) may land in the same look */
const SENT_LOOKBACK = 4;

/**
 * The reader's message a send just appended, or null. `previousTail` is the id the tail had at the
 * last look: the send is a user message among the messages after it, with that tail still right
 * before it (a pure append to the thread on screen, not a chat switch or a reload that replaced the
 * ids). In a chat that was empty the send is the only message, so a history landing is not one.
 */
export function sentMessage(messages: readonly Pick<Message, 'id' | 'role'>[], previousTail: string | null): string | null {
  if (previousTail === null) return messages.length === 1 && messages[0].role === 'user' ? messages[0].id : null;
  const stop = Math.max(1, messages.length - SENT_LOOKBACK);
  for (let index = messages.length - 1; index >= stop; index--) {
    const message = messages[index];
    if (message.id === previousTail) return null;
    if (message.role === 'user') return messages[index - 1].id === previousTail ? message.id : null;
  }
  return null;
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
