/**
 * Which user message the transcript pins, and how far the next turn pushes it
 * up, as plain arithmetic over the list's row frames - what CSS `position:
 * sticky` does for the desktop's user bubbles (components/assistant-ui/thread
 * user-message, `--sticky-human-top`).
 *
 * A prompt pins once its bubble has scrolled above the pin line and holds while
 * its turn is in view. The turn's end carries it off: when the next prompt (or
 * the end of the list) comes within the pinned bubble's height of the pin line,
 * the bubble rides up with it, and the later prompt takes over from there.
 */

import type { RowFrame } from './scroll.ts';

/** desktop `--sticky-human-top`, 0.23rem */
export const STICKY_TOP = 3.68;
/** the clamp, in lines: desktop `.sticky-human-clamp` is 4 lines of 1.3 leading */
export const STICKY_CLAMP_LINES = 4;

export type StickyRow = { id: string; role: 'user' | 'assistant' | 'system' };

export type StickyPin = { id: string; index: number; turnEnd: number };

/**
 * The prompt pinned at `scrollY`. `rowPad` is the gap between a cell's top and
 * its bubble. Rows with no measured frame cannot be the pin line's neighbour and
 * are skipped, so a list still laying out pins nothing rather than the wrong
 * prompt.
 */
export function pinnedPrompt(rows: readonly StickyRow[], frames: ReadonlyMap<string, RowFrame>, scrollY: number, rowPad: number, contentBottom: number): StickyPin | null {
  const line = scrollY + STICKY_TOP;
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].role !== 'user') continue;
    const frame = frames.get(rows[index].id);
    if (!frame || frame.y + rowPad > line + 1) continue;
    let turnEnd = contentBottom;
    for (let next = index + 1; next < rows.length; next++) {
      const after = rows[next].role === 'user' ? frames.get(rows[next].id) : undefined;
      if (after) {
        turnEnd = after.y + rowPad;
        break;
      }
    }
    return { id: rows[index].id, index, turnEnd };
  }
  return null;
}

/** how far up the pinned bubble sits: 0 until the turn's end comes within its height, then riding up with it */
export function pinOffset(pin: StickyPin, scrollY: number, bubbleHeight: number): number {
  return Math.min(0, pin.turnEnd - (scrollY + STICKY_TOP + bubbleHeight));
}
