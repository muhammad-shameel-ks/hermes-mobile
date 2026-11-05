/**
 * One switch for every face's clock. A face repaints SVG geometry (`AnimatedFace`), and each of those
 * paints is a shadow-tree commit; a roster of faces keeps ~15 commits a second each while it idles.
 * That work is invisible while a finger is dragging the list and competes with the drag for the same
 * thread, so the roster pauses the clocks for the length of a scroll and resumes as it settles.
 *
 * A shared value, not a store: pausing must not re-render every face or re-register its frame callback
 * at the very moment the scroll starts. The callback reads it on the UI thread and returns.
 */

import { makeMutable } from 'react-native-reanimated';

export const facesPaused = makeMutable(false);

export function setFacesPaused(next: boolean): void {
  facesPaused.value = next;
}
