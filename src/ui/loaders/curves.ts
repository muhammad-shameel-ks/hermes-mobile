/**
 * The loader engine's maths, ported from the desktop's components/ui/loader.tsx
 * (`LOADER_CURVES`, `buildPath`, `particleFor`, `detailScaleFor`, `rotationFor`,
 * `roseCurve`) and glyph-spinner.tsx, via the prototype/shell-loader branch.
 *
 * The per-frame worklet lives in frame.ts; this file holds the tables and the
 * glyph frames, which stay plain JS.
 */

import type { CurveConfig, LoaderKind } from './frame.ts';

export type { CurveConfig, LoaderKind };

export const CURVES: Record<LoaderKind, CurveConfig> = {
  'rose-curve': {
    durationMs: 5400,
    particleCount: 78,
    pulseDurationMs: 4600,
    rotate: true,
    rotationDurationMs: 28000,
    strokeWidth: 4.5,
    trailSpan: 0.32,
  },
  'lemniscate-bloom': {
    durationMs: 5600,
    particleCount: 70,
    pulseDurationMs: 5000,
    rotate: false,
    // the desktop's baseCurve default; unused while `rotate` is off
    rotationDurationMs: 34000,
    strokeWidth: 4.8,
    trailSpan: 0.4,
  },
};

/** desktop `Loader` default `pathSteps` */
export const PATH_STEPS = 240;

/**
 * One path carries the whole trail, so it takes a single opacity near the mean of
 * the desktop's per-particle `0.04 + fade * 0.96`; the radius taper carries the rest.
 */
export const TRAIL_OPACITY = 0.72;

/** The faint curve the trail runs along: the desktop's `opacity="0.1"` path */
export const CURVE_OPACITY = 0.1;

export type GlyphSpinnerName = 'braille' | 'breathe';

/** `unicode-animations` frames (first cell of each) and the per-frame interval, as the desktop's GlyphSpinner reads them */
export const GLYPH_SPINNERS: Record<GlyphSpinnerName, { frames: readonly string[]; interval: number }> = {
  braille: { frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], interval: 80 },
  breathe: { frames: ['⠀', '⠂', '⠌', '⡑', '⢕', '⢝', '⣫', '⣟', '⣿', '⣟', '⣫', '⢝', '⢕', '⡑', '⠌', '⠂', '⠀'], interval: 100 },
};

/**
 * The strip a glyph spinner scrolls: its frames plus a copy of the first. The
 * travel is N frame-heights over N steps, so the sampling lands one line past
 * the last glyph at the end of a cycle; the copy makes that position and the
 * restart paint the same thing, so the wrap shows no blank frame.
 */
export const glyphStrip = (name: GlyphSpinnerName): string[] => {
  const { frames } = GLYPH_SPINNERS[name];
  return [...frames, frames[0]];
};
