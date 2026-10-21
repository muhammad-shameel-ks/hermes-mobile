/**
 * The drawer's swipe maths, pure so Node can test it. `progress` is the drawer's one animated value:
 * 0 shut, 1 open, the panel sliding `width` px between them. `dragProgress` and `settlesOpen` run as
 * worklets on the UI thread.
 */

/** a swipe past this speed (px/s) decides on its own, whatever the distance */
export const FLING_VELOCITY = 500;

/** the travel a released swipe across the open drawer needs to change tab, short of a fling */
export const TAB_SWIPE_PX = 48;

/** where the drawer stands while a finger that began on the shut drawer has moved `translationX` */
export function dragProgress(translationX: number, width: number): number {
  'worklet';
  const next = translationX / width;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

/** whether a released drag leaves the drawer open: a fling decides, otherwise the nearer end */
export function settlesOpen(progress: number, velocityX: number): boolean {
  'worklet';
  if (velocityX > FLING_VELOCITY) return true;
  if (velocityX < -FLING_VELOCITY) return false;
  return progress > 0.5;
}

/**
 * Which way a released swipe across the open drawer moves through its tabs: a left swipe to the next
 * tab (+1), a right swipe to the one before (-1), anything shorter and slower stays (0). A fling
 * decides by its direction, as `settlesOpen` does.
 */
export function tabStep(translationX: number, velocityX: number): -1 | 0 | 1 {
  if (velocityX < -FLING_VELOCITY) return 1;
  if (velocityX > FLING_VELOCITY) return -1;
  if (translationX <= -TAB_SWIPE_PX) return 1;
  if (translationX >= TAB_SWIPE_PX) return -1;
  return 0;
}
