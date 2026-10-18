/**
 * The drawer's swipe maths, pure so Node can test it. `progress` is the drawer's one animated value:
 * 0 shut, 1 open, the panel sliding `width` px between them. These run as worklets on the UI thread.
 */

/** a swipe past this speed (px/s) decides the drawer on its own, whatever the distance */
export const FLING_VELOCITY = 500;

/** where the drawer stands while a finger that began at `from` (0 shut, 1 open) has moved `translationX` */
export function dragProgress(from: 0 | 1, translationX: number, width: number): number {
  'worklet';
  const next = from + translationX / width;
  return next < 0 ? 0 : next > 1 ? 1 : next;
}

/** whether a released drag leaves the drawer open: a fling decides, otherwise the nearer end */
export function settlesOpen(progress: number, velocityX: number): boolean {
  'worklet';
  if (velocityX > FLING_VELOCITY) return true;
  if (velocityX < -FLING_VELOCITY) return false;
  return progress > 0.5;
}
