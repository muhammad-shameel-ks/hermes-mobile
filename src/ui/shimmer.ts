/**
 * The desktop's `shimmer` text utility (tw-shimmer, used by the transcript's
 * wait hints) as numbers a native view can animate. CSS clips a moving
 * 17-stop gradient to the glyphs; with no text masking on React Native the
 * band is rebuilt from nested windows, each revealing a highlight copy of the
 * text at the opacity that makes the stack follow the same sine falloff.
 */

import { hexToOklch, mixPct, oklchToHex } from './color.ts';

/** tw-shimmer's defaults: 200 px/s, a 15° band over a 200 px track, 20000 / speed ms between sweeps */
const SPEED_PX_S = 200;
const TRACK_PX = 200;
const ANGLE_DEG = 15;
/** a `ch` in the UI face, as a fraction of the font size */
const CH_EM = 0.55;

export type ShimmerTiming = { spread: number; sweepMs: number; delayMs: number };

/** `--_spread: calc(4ch + 80px)`, `--_duration` and `--_repeat-delay` at the default speed */
export function shimmerTiming(fontSize: number): ShimmerTiming {
  const spread = 4 * CH_EM * fontSize + 80;
  const gradientWidth = spread + TRACK_PX * Math.tan((ANGLE_DEG * Math.PI) / 180);
  return { spread, sweepMs: Math.round(((TRACK_PX + gradientWidth) / SPEED_PX_S) * 1000), delayMs: Math.round(20000 / SPEED_PX_S) };
}

// the utility's stops, outermost first: distance from the band's centre as a fraction of the spread, and how much highlight shows there
const STOPS: ReadonlyArray<[number, number]> = [
  [0.44, 0.04],
  [0.37, 0.17],
  [0.31, 0.33],
  [0.25, 0.5],
  [0.19, 0.67],
  [0.12, 0.83],
  [0.06, 0.96],
  [0, 1],
];

export type ShimmerRing = { halfWidth: number; opacity: number };

/**
 * Nested windows, outermost first. Each reaches halfway to the next stop out
 * and shows the highlight copy at the opacity that brings the stacked coverage
 * up to that stop's weight, scaled by `peak` (how far the centre goes toward
 * the highlight colour).
 */
export function shimmerRings(spread: number, peak = 1): ShimmerRing[] {
  let covered = 0;
  return STOPS.map(([at, weight], index) => {
    const outer = index === 0 ? 0.5 : STOPS[index - 1][0];
    const target = weight * peak;
    const opacity = covered >= 1 ? 0 : (target - covered) / (1 - covered);
    covered = target;
    return { halfWidth: ((at + outer) / 2) * spread, opacity: Math.max(0, Math.min(1, opacity)) };
  });
}

/**
 * What the band's centre turns the text into, as an overlay colour and how far
 * toward it. Dark: `oklch(from currentColor max(0.8, l + 0.4) c h / alpha + 0.4)`,
 * near-opaque and bright. Light: `oklch(from currentColor l c h / alpha * 0.2)`,
 * the text fading to a fifth, which an overlay reaches by painting the surface.
 */
export function shimmerHighlight(ink: string, surface: string, dark: boolean): { color: string; peak: number } {
  if (!dark) return { color: surface, peak: 0.8 };
  // the ink's own channels: its alpha rises past 1 at the centre
  const rgb = mixPct(ink, 1, ink).slice(0, 7);
  const lch = hexToOklch(rgb);
  return { color: lch ? oklchToHex({ ...lch, l: Math.max(0.8, lch.l + 0.4) }) : rgb, peak: 1 };
}
