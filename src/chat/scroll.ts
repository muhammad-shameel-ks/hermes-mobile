/**
 * The transcript's scroll rules as plain arithmetic: whether the list follows a
 * streaming reply, when the floating jump-to-bottom control shows and how many
 * messages it counts (desktop app/chat/scroll-to-bottom-button and
 * thread/use-messages-below).
 */

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
 * lands before the gesture's first scroll echo cannot pull the reader back down, and where the
 * gesture comes to rest decides whether following resumes - within `JUMP_SHOW_DISTANCE`, where
 * the jump pill stays hidden, it does. Any scroll that reaches the bottom (a send, the pill, a
 * thread switch) pins again; a scroll the reader did not drive never unpins.
 *
 * Android reports momentum for a commanded animated scroll too, so momentum counts as a fling
 * only when it starts straight out of a drag, before the list is commanded anywhere.
 */
export class TailFollow {
  private pinned = true;
  private gesture = false;
  private afterDrag = false;
  private flinging = false;

  dragStart(): void {
    this.gesture = true;
    this.afterDrag = false;
    this.flinging = false;
  }

  /** the finger lifted `distance` from the bottom; a fling may follow */
  dragEnd(distance: number): void {
    this.settle(distance);
    this.afterDrag = true;
  }

  flingStart(): void {
    if (!this.afterDrag) return;
    this.afterDrag = false;
    this.flinging = true;
    this.gesture = true;
  }

  /** momentum came to rest `distance` from the bottom */
  flingEnd(distance: number): void {
    if (!this.flinging) return;
    this.flinging = false;
    this.settle(distance);
  }

  /** the app is about to scroll the list itself; momentum from here on is not the reader's */
  commanded(): void {
    this.afterDrag = false;
  }

  /** any scroll echo, `distance` from the bottom */
  scrolled(distance: number): void {
    if (distance <= PINNED_DISTANCE) this.pinned = true;
    else if (this.gesture) this.pinned = false;
  }

  /** the list is told to sit on the bottom (the jump pill) */
  pin(): void {
    this.pinned = true;
  }

  reset(): void {
    this.pinned = true;
    this.gesture = false;
    this.afterDrag = false;
    this.flinging = false;
  }

  /** whether growing content should carry the list down with it */
  get follows(): boolean {
    return this.pinned && !this.gesture;
  }

  private settle(distance: number): void {
    this.gesture = false;
    this.pinned = distance <= JUMP_SHOW_DISTANCE;
  }
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
