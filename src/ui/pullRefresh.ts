/**
 * Pull-to-refresh as arithmetic, so the two rules that decide what the reader sees can be tested
 * without a device: when a pull arms the loader, and when the spinner stops.
 *
 * The spinner is `armed && started && refreshing`, and the `refreshing` term is load-bearing: on the
 * render that hears a refresh end, `started` is still true (a ref cleared in an effect does not
 * re-render), so leaving it out showed `refreshing={true}` to the platform control and stranded the
 * list under its inset and a 64 dp header.
 */

/** how far the list must be pulled before the loader appears at all: past an ordinary top-of-list bounce */
export const ARMED_PULL_DP = 56;
/** within this of the list's top it is back at rest: the next downward pull is the reader's again */
export const PULL_RELEASE_DP = 8;

/**
 * Whether a pull at `offset` (negative above the list's top) leaves the loader armed. A pull past the
 * arming distance arms it; the list returning to its top disarms it. Anything between leaves it as it
 * was, so a finger hovering at the arming distance cannot mount and unmount the header frame by frame,
 * and the inset springing back after a refresh (a pull the app already consumed) cannot re-arm it.
 */
export function pullArmed(offset: number, armed: boolean, settling: boolean, started: boolean): boolean {
  if (offset >= -PULL_RELEASE_DP) return started ? armed : false;
  if (offset < -ARMED_PULL_DP && !settling && !started) return true;
  return armed;
}

/** whether the platform spinner shows: a refresh the app started on its own never shows one */
export function pullSpinner(refreshing: boolean, armed: boolean, started: boolean): boolean {
  return armed && started && refreshing;
}
