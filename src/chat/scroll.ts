/**
 * The transcript's floating jump-to-bottom control, as plain arithmetic: when it
 * shows and how many messages it counts (desktop app/chat/scroll-to-bottom-button
 * and thread/use-messages-below).
 */

export type RowFrame = { y: number; height: number };

/** farther than this from the bottom edge and the reader has left the tail */
export const JUMP_SHOW_DISTANCE = 72;

export function distanceFromBottom(scrollY: number, viewportHeight: number, contentHeight: number): number {
  return Math.max(0, contentHeight - scrollY - viewportHeight);
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
