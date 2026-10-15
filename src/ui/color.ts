/**
 * The desktop-only colour helpers the token resolver needs, beside the shared
 * sRGB primitives in vendor/hermes-shared. The OKLCH toolkit, `luminance`,
 * `normalizeHex` and `readableInk` are verbatim from
 * apps/desktop/src/themes/color.ts; `mixPct` stands in for CSS
 * `color-mix(in srgb, …)`, which React Native does not have.
 */

import { contrastRatio, parseColor, readableOn, relativeLuminance, toHex } from '../../vendor/hermes-shared/src/color.ts';

type Rgba = readonly [number, number, number, number];

const clampChannel = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** The desktop's ink pair: its near-black text colour, not pure black. */
const DESKTOP_INKS = ['#161616', '#ffffff'] as const;

/** A readable foreground (`#161616` or `#ffffff`) for a background hex. */
export const readableInk = (bg: string): string => readableOn(bg, DESKTOP_INKS);

/**
 * Coerce a CSS hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `#` optional)
 * into a flat `#rrggbb`, compositing alpha over `backdrop`. Null for anything else.
 */
export function normalizeHex(input: string | undefined | null, backdrop = '#000000'): string | null {
  if (typeof input !== 'string') return null;
  let clean = input.trim().replace(/^#/, '');
  if (clean.length === 3 || clean.length === 4) {
    clean = clean
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(clean)) return null;
  const rgb = parseColor(`#${clean.slice(0, 6)}`);
  if (!rgb) return null;
  if (clean.length === 6) return toHex(rgb);
  const alpha = parseInt(clean.slice(6, 8), 16) / 255;
  const base = parseColor(backdrop) ?? [0, 0, 0];
  return toHex([base[0] + (rgb[0] - base[0]) * alpha, base[1] + (rgb[1] - base[1]) * alpha, base[2] + (rgb[2] - base[2]) * alpha]);
}

/** Perceptual-ish luminance in 0..1 (naive, for light/dark bucketing). */
export function luminance(hex: string): number {
  const rgb = parseColor(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseRgba(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (value === 'transparent') return [0, 0, 0, 0];
  const hex = value.replace(/^#/, '');
  if (/^[0-9a-f]{8}$/.test(hex)) {
    const rgb = parseColor(`#${hex.slice(0, 6)}`);
    return rgb ? [rgb[0], rgb[1], rgb[2], parseInt(hex.slice(6, 8), 16) / 255] : null;
  }
  const rgb = parseColor(value);
  return rgb ? [rgb[0], rgb[1], rgb[2], 1] : null;
}

/**
 * CSS `color-mix(in srgb, a P%, b)` with P = `p` (0..1). Interpolation is
 * premultiplied, as the CSS colour spec requires, so mixing toward `transparent`
 * keeps the colour and only moves alpha. Returns `#rrggbb` when opaque,
 * `#rrggbbaa` otherwise.
 */
export function mixPct(a: string, p: number, b: string): string {
  const ca = parseRgba(a);
  const cb = parseRgba(b);
  if (!ca || !cb) return a;
  const t = Math.min(1, Math.max(0, p));

  if (ca[3] === 1 && cb[3] === 1) {
    return toHex([ca[0] * t + cb[0] * (1 - t), ca[1] * t + cb[1] * (1 - t), ca[2] * t + cb[2] * (1 - t)]);
  }

  const alpha = ca[3] * t + cb[3] * (1 - t);
  if (alpha === 0) return '#00000000';
  const chan = (i: 0 | 1 | 2) => (ca[i] * ca[3] * t + cb[i] * cb[3] * (1 - t)) / alpha;
  return toHex([chan(0), chan(1), chan(2)]) + clampChannel(alpha * 255).toString(16).padStart(2, '0');
}

// ─── OKLCH (desktop themes/color.ts) ─────────────────────────────────────────

const linearize01 = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const delinearize01 = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Perceptual lightness 0..1, chroma (~0..0.37), hue 0..360. */
export type Oklch = { l: number; c: number; h: number };

function rgbToOklab([r255, g255, b255]: readonly number[]): [number, number, number] {
  const [r, g, b] = [r255, g255, b255].map((v) => linearize01(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseColor(hex);
  if (!rgb) return null;
  const [okL, okA, okB] = rgbToOklab(rgb);
  return { l: okL, c: Math.hypot(okA, okB), h: ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360 };
}

function oklabToHex([okL, okA, okB]: readonly number[]): string {
  return oklchToHex({ l: okL, c: Math.hypot(okA, okB), h: ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360 });
}

function oklchToRgbRaw({ l: okL, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const okA = c * Math.cos(rad);
  const okB = c * Math.sin(rad);
  const l = (okL + 0.3963377774 * okA + 0.2158037573 * okB) ** 3;
  const m = (okL - 0.1055613458 * okA - 0.0638541728 * okB) ** 3;
  const s = (okL - 0.0894841775 * okA - 1.291485548 * okB) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inSrgbGamut = (rgb: readonly number[]): boolean => rgb.every((c) => c >= -0.001 && c <= 1.001);

export function oklchToHex(color: Oklch): string {
  const toSrgb = (raw: readonly number[]) => toHex(raw.map((c) => delinearize01(c) * 255) as [number, number, number]);
  if (inSrgbGamut(oklchToRgbRaw(color))) return toSrgb(oklchToRgbRaw(color));
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(oklchToRgbRaw({ ...color, c: mid }))) lo = mid;
    else hi = mid;
  }
  return toSrgb(oklchToRgbRaw({ ...color, c: lo }));
}

export function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(oklchToRgbRaw({ l, c: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Signed shortest angular distance from `from` to `to`, in degrees (-180..180). */
export const hueDelta = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

/** Bend a semantic colour toward the accent along the shortest hue arc. */
export function harmonize(hex: string, accent: string, strength: number): string {
  const base = hexToOklch(hex);
  const target = hexToOklch(accent);
  if (!base || !target) return hex;
  const h = (base.h + hueDelta(base.h, target.h) * Math.min(1, Math.max(0, strength)) + 360) % 360;
  return oklchToHex({ ...base, c: Math.min(Math.max(base.c, target.c * 0.85), maxChroma(base.l, h)), h });
}

/** OKLCH → 0–255 sRGB, or `null` when the colour is outside the display's gamut. */
export function oklchToSrgb255(color: Oklch): [number, number, number] | null {
  const raw = oklchToRgbRaw(color);
  if (!inSrgbGamut(raw)) return null;
  return raw.map((c) => Math.round(Math.min(1, Math.max(0, delinearize01(c))) * 255)) as [number, number, number];
}

/** Blend two colours in OKLab, the hue-stable counterpart to sRGB mixing; use it for anything derived from the brand seed. */
export function mixOklab(a: string, b: string, amount: number): string {
  const ra = parseColor(a);
  const rb = parseColor(b);
  if (!ra || !rb) return a;
  const la = rgbToOklab(ra);
  const lb = rgbToOklab(rb);
  const t = Math.min(1, Math.max(0, amount));
  return oklabToHex([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t]);
}

/** Re-hue a colour, holding its perceived lightness and colourfulness. */
export function withHue(hex: string, hue: number): string {
  const lch = hexToOklch(hex);
  return lch ? oklchToHex({ ...lch, h: ((hue % 360) + 360) % 360 }) : hex;
}

/**
 * Make `hex` clear `min` contrast against `bg` by moving its OKLCH lightness only,
 * keeping hue and chroma. Returns the original when it already passes.
 */
export function ensureContrastOklch(hex: string, bg: string, min: number): string {
  const ratio = contrastRatio(hex, bg);
  if (ratio === null || ratio >= min) return hex;
  const lch = hexToOklch(hex);
  if (!lch) return hex;
  const up = (relativeLuminance(bg) ?? 0) < 0.5;
  let best = hex;
  for (let step = 1; step <= 40; step += 1) {
    const l = lch.l + (up ? step : -step) * 0.02;
    if (l <= 0 || l >= 1) break;
    best = oklchToHex({ ...lch, l });
    if ((contrastRatio(best, bg) ?? 0) >= min) return best;
  }
  return best;
}
