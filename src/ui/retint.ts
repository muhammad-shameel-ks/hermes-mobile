/**
 * Accent retinting, ported from apps/desktop/src/themes/retint.ts: move a
 * palette's accent family to one colour and re-derive the soft surfaces mixed
 * from it with the converter's own ratios. The chrome neutrals stay untouched.
 */

import type { ThemePresetColors } from '../../vendor/hermes-shared/src/theme-presets.ts';
import { ensureContrastOklch, hexToOklch, hueDelta, mixOklab, normalizeHex, oklchToHex, readableInk, type Oklch } from './color.ts';

/** Small uppercase sidebar labels paint in the accent, so it must clear AA. */
const ACCENT_MIN_CONTRAST = 4.5;
/** How far a slot's hue may sit from the primary and still count as the same accent family. */
const ACCENT_HUE_TOLERANCE = 25;
/** Below this chroma a colour is a grey and its hue is noise. */
const ACCENT_MIN_CHROMA = 0.03;
/** Slots that carry the accent itself, rather than a surface mixed from it. */
const ACCENT_SEED_KEYS = ['primary', 'ring', 'midground', 'composerRing'] as const;
/** Slots mixed from the seed, as ratios per mode: the converter's own numbers. */
const ACCENT_MIX = {
  accent: { light: 0.88, dark: 0.82 },
  secondary: { light: 0.86, dark: 0.72 },
  userBubble: { light: 0.12, dark: 0.18 },
} as const;

function tracksAccent(slot: Oklch, primary: Oklch): boolean {
  if (slot.c < ACCENT_MIN_CHROMA) return primary.c < ACCENT_MIN_CHROMA;
  return Math.abs(hueDelta(primary.h, slot.h)) <= ACCENT_HUE_TOLERANCE;
}

function retintColors(colors: ThemePresetColors, seed: string, isDark: boolean): ThemePresetColors {
  const next: ThemePresetColors = { ...colors };
  const pick = (spec: { dark: number; light: number }) => (isDark ? spec.dark : spec.light);
  const primary = hexToOklch(colors.primary);
  const seedLch = hexToOklch(seed);

  for (const key of ACCENT_SEED_KEYS) {
    const slot = colors[key];
    const lch = slot ? hexToOklch(slot) : null;
    if (!slot || !lch || !primary || !seedLch || !tracksAccent(lch, primary)) continue;
    next[key] = slot === colors.primary ? seed : oklchToHex({ ...lch, h: seedLch.h });
  }

  next.accent = mixOklab(seed, colors.background, pick(ACCENT_MIX.accent));
  next.secondary = mixOklab(seed, colors.background, pick(ACCENT_MIX.secondary));
  next.userBubble = mixOklab(colors.card, seed, pick(ACCENT_MIX.userBubble));
  next.primaryForeground = readableInk(seed);
  next.midgroundForeground = readableInk(seed);
  return next;
}

/**
 * `colors` with its accent family re-seeded from `color`, the seed adapted to
 * stay legible on the palette's own sidebar. The desktop's `retintTheme(...).colors`
 * for a palette without a dark twin, which is how it paints each mode of an accented skin.
 * The palette's own accent, or an unparseable colour, returns it unchanged.
 */
export function retintPalette(colors: ThemePresetColors, color: string): ThemePresetColors {
  const seed = normalizeHex(color);
  if (!seed) return colors;
  if (seed.toLowerCase() === colors.primary.toLowerCase()) return colors;
  const light = ensureContrastOklch(seed, colors.sidebarBackground ?? colors.background, ACCENT_MIN_CONTRAST);
  return colors.primary === light ? colors : retintColors(colors, light, false);
}

/** The accent's current hue in degrees. */
export function paletteHue(colors: ThemePresetColors): number {
  const lch = hexToOklch(colors.primary);
  return lch ? Math.round(lch.h) : 0;
}
