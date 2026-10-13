/**
 * Prototype colour module — `apps/shared/src/color.ts` and
 * `apps/desktop/src/themes/color.ts` merged into one dependency-free file, plus
 * `mixPct` for CSS `color-mix(in srgb, …)` semantics. Bodies are verbatim from
 * both sources; the only change is that the desktop file's
 * `@hermes/shared/color` import is gone (those helpers now live below).
 *
 * sRGB primitives (shared): parseColor, toHex, mix, relativeLuminance,
 * contrastRatio, readableOn, ensureContrast, lighten, darken.
 * Desktop-only: readableInk, luminance, normalizeHex, and the OKLCH toolkit —
 * hexToOklch, oklchToHex, oklchToSrgb255, maxChroma, hueDelta, harmonize,
 * mixOklab, withHue, ensureContrastOklch.
 * Added here: mixPct.
 */

export type Rgb = readonly [number, number, number]

const HEX6_RE = /^#?([0-9a-f]{6})$/i
const HEX3_RE = /^#?([0-9a-f]{3})$/i
const RGB_FN_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i

const clampChannel = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/** Parse `#rgb`, `#rrggbb` or `rgb(r,g,b)` → channels. Null for anything else. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim()

  let m = HEX6_RE.exec(value)

  if (m) {
    const n = parseInt(m[1]!, 16)

    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  }

  m = HEX3_RE.exec(value)

  if (m) {
    const [r, g, b] = m[1]!

    return [parseInt(r! + r!, 16), parseInt(g! + g!, 16), parseInt(b! + b!, 16)]
  }

  m = RGB_FN_RE.exec(value)

  if (m) {
    return [clampChannel(Number(m[1])), clampChannel(Number(m[2])), clampChannel(Number(m[3]))]
  }

  return null
}

export const toHex = (rgb: Rgb): string => '#' + rgb.map(c => clampChannel(c).toString(16).padStart(2, '0')).join('')

/** sRGB lerp `a → b` by `t` in [0,1]. Unparseable inputs return `a` unchanged. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseColor(a)
  const pb = parseColor(b)

  if (!pa || !pb) {
    return a
  }

  return toHex([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t])
}

/** `#rrggbb` / `#rgb` / `rgb()` / `rgba()` / `transparent` → non-premultiplied 0–255 channels + alpha 0..1. */
function parseRgba(input: string): [number, number, number, number] | null {
  const value = input.trim().toLowerCase()

  if (value === 'transparent') {
    return [0, 0, 0, 0]
  }

  const hex = value.replace(/^#/, '')

  if (/^[0-9a-f]{3,4}$/.test(hex)) {
    const [r, g, b, a] = hex

    return [
      parseInt(r! + r!, 16),
      parseInt(g! + g!, 16),
      parseInt(b! + b!, 16),
      a ? parseInt(a + a, 16) / 255 : 1
    ]
  }

  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) {
    const rgb = parseColor(`#${hex.slice(0, 6)}`)

    if (!rgb) {
      return null
    }

    return hex.length === 8
      ? [rgb[0], rgb[1], rgb[2], parseInt(hex.slice(6, 8), 16) / 255]
      : [rgb[0], rgb[1], rgb[2], 1]
  }

  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?/i.exec(value)

  if (m) {
    return [
      clampChannel(Number(m[1])),
      clampChannel(Number(m[2])),
      clampChannel(Number(m[3])),
      m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4])))
    ]
  }

  return null
}

/**
 * CSS `color-mix(in srgb, a P%, b)` with P = `p` (0..1): per-channel
 * `a*p + b*(1-p)`, rounded. Interpolation is premultiplied (the CSS colour
 * spec's rule), so mixing a colour toward `transparent` (rgba 0,0,0,0) keeps
 * the colour and only moves alpha — `mixPct('#0053fd', 0.74, 'transparent')`
 * is the same blue at alpha 0.74. Returns `#rrggbb` when the result is opaque,
 * `#rrggbbaa` otherwise. Accepts `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()`.
 */
export function mixPct(a: string, p: number, b: string): string {
  const ca = parseRgba(a)
  const cb = parseRgba(b)

  if (!ca || !cb) {
    return a
  }

  const t = Math.min(1, Math.max(0, p))

  // Opaque in, opaque out — six channels, no alpha byte.
  if (ca[3] === 1 && cb[3] === 1) {
    return toHex([
      ca[0] * t + cb[0] * (1 - t),
      ca[1] * t + cb[1] * (1 - t),
      ca[2] * t + cb[2] * (1 - t)
    ])
  }

  const alpha = ca[3] * t + cb[3] * (1 - t)

  // Premultiplied colour sum, then un-premultiply by the result alpha so a fade
  // to `transparent` does not drag the hue toward black.
  const chan = (i: 0 | 1 | 2) => (ca[i] * ca[3] * t + cb[i] * cb[3] * (1 - t)) / alpha

  const hex = toHex([chan(0), chan(1), chan(2)])
  const alphaHex = clampChannel(alpha * 255).toString(16).padStart(2, '0')

  return hex + alphaHex
}

function channelLuminance(value: number): number {
  const normalized = value / 255

  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance in [0,1]. Null when unparseable. */
export function relativeLuminance(color: string): null | number {
  const rgb = parseColor(color)

  return rgb
    ? 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2])
    : null
}

/** WCAG contrast ratio between two colors (1–21). Null when unparseable. */
export function contrastRatio(a: string, b: string): null | number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)

  if (la === null || lb === null) {
    return null
  }

  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]

  return (hi + 0.05) / (lo + 0.05)
}

const DEFAULT_INKS = ['#000000', '#ffffff'] as const

/**
 * The readable ink for a background: whichever candidate MEASURES better.
 *
 * Splitting on a luminance threshold got mid-lightness accents wrong in the
 * direction that matters — white on GitHub's dark green `#4f9e5e` is 3.29:1
 * (fails AA) where near-black is 5.50:1, and Catppuccin's mauve was a 2.03:1
 * white-on-lilac. Two candidates is a cheap enough search to just measure.
 * Ties and an unparseable background (nothing to measure against) go to the
 * LAST candidate — the light pole in both the default pair and the desktop's,
 * which is what both surfaces previously fell back to.
 */
export function readableOn(bg: string, inks: readonly [string, ...string[]] = DEFAULT_INKS): string {
  let best: string = inks[inks.length - 1]!
  let bestRatio = -1

  for (const ink of inks) {
    const ratio = contrastRatio(bg, ink)

    if (ratio !== null && ratio >= bestRatio) {
      best = ink
      bestRatio = ratio
    }
  }

  return best
}

/**
 * Step-mix `color` toward the pole opposite `bg` (white on a dark background,
 * black on a light one) until the contrast ratio clears `min`. Each rung
 * re-mixes from the ORIGINAL color, so hue decays linearly, not
 * exponentially, and the color stops at the first rung that passes. Returns
 * the original when it already passes or isn't parseable.
 *
 * `step` is the rung size. The default 0.2 (5 rungs) is the desktop's ladder
 * and MUST stay: `--dt-primary-solid` for every shipped preset is derived
 * from it and a finer ladder lands visibly different fills (nous `#3b6acb` vs
 * `#3f70d8`). The TUI's chainable form opts into 0.05 for less hue loss.
 * The accumulating loop (rather than `i * step`) is deliberate — it is the
 * exact float sequence the old desktop ladder produced.
 *
 * Invalid rungs are normalized instead of trusted: a finite `step` in
 * (0.001, 1] is used as-is (clamped to 1 above that), everything else —
 * non-finite, non-positive, or too small to reach the bound in a reasonable
 * number of rungs (including denormals like `Number.MIN_VALUE`) — falls back
 * to the default ladder. The helper terminates for every JavaScript number.
 */
export function ensureContrast(color: string, bg: string, min: number, step = 0.2): string {
  const bgLuminance = relativeLuminance(bg)

  if (bgLuminance === null || parseColor(color) === null) {
    return color
  }

  const ratio = contrastRatio(color, bg)

  if (ratio === null || ratio >= min) {
    return color
  }

  const pole = bgLuminance < 0.5 ? '#ffffff' : '#000000'
  let best = color

  const rung = Number.isFinite(step) && step >= 0.001 ? Math.min(step, 1) : 0.2

  for (let amount = rung; amount <= 1.0001; amount += rung) {
    best = mix(color, pole, Math.min(amount, 1))

    const stepRatio = contrastRatio(best, bg)

    if (stepRatio !== null && stepRatio >= min) {
      return best
    }
  }

  return best
}

/** Recede toward the background pole (opposite of `readableOn`). */
export const lighten = (color: string, t: number) => mix(color, '#ffffff', t)
export const darken = (color: string, t: number) => mix(color, '#000000', t)

// ─── Desktop-only helpers ────────────────────────────────────────────────────

/** The desktop's ink pair: its near-black text colour, not pure black. */
const DESKTOP_INKS = ['#161616', '#ffffff'] as const

/** A readable foreground (`#161616` or `#ffffff`) for a background hex. */
export const readableInk = (bg: string): string => readableOn(bg, DESKTOP_INKS)

/** Perceptual-ish luminance in 0..1 (naive, for light/dark bucketing). */
export function luminance(hex: string): number {
  const rgb = parseColor(hex)

  if (!rgb) {
    return 0
  }

  const [r, g, b] = rgb.map(v => v / 255)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Coerce any CSS hex color VS Code themes throw at us into a flat 6-digit
 * `#rrggbb`, compositing alpha over `backdrop`. Accepts `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa` (with or without the leading `#`). Returns null for
 * non-hex values (named colors, `rgb()`, etc.) so callers can fall back.
 */
export function normalizeHex(input: string | undefined | null, backdrop = '#000000'): string | null {
  if (typeof input !== 'string') {
    return null
  }

  let clean = input.trim().replace(/^#/, '')

  // Expand shorthand (#rgb / #rgba) to full width.
  if (clean.length === 3 || clean.length === 4) {
    clean = clean
      .split('')
      .map(ch => ch + ch)
      .join('')
  }

  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(clean)) {
    return null
  }

  const rgb = parseColor(`#${clean.slice(0, 6)}`)

  if (!rgb) {
    return null
  }

  if (clean.length === 6) {
    return toHex(rgb)
  }

  const alpha = parseInt(clean.slice(6, 8), 16) / 255
  const base = parseColor(backdrop) ?? [0, 0, 0]

  return toHex([
    base[0] + (rgb[0] - base[0]) * alpha,
    base[1] + (rgb[1] - base[1]) * alpha,
    base[2] + (rgb[2] - base[2]) * alpha
  ])
}

// ─── OKLCH ──────────────────────────────────────────────────────────────────
// Hue rotation has to happen in a perceptual space or it lies. Holding HSL's
// saturation+lightness across a hue sweep gives you mud at 60° (`#6d6d19`) and
// a washed teal at 200°, because HSL "lightness" is not lightness. OKLCH holds
// perceived lightness and colorfulness steady, so every hue lands with the same
// visual weight — which is what makes a single hue knob safe to expose.

const linearize01 = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const delinearize01 = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/** Perceptual lightness 0..1, chroma (~0..0.37), hue 0..360. */
export interface Oklch {
  l: number
  c: number
  h: number
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseColor(hex)

  if (!rgb) {
    return null
  }

  const [okL, okA, okB] = rgbToOklab(rgb)

  return {
    l: okL,
    c: Math.hypot(okA, okB),
    h: ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360
  }
}

/** 0–255 sRGB triple → OKLab [L, a, b]. */
function rgbToOklab([r255, g255, b255]: readonly number[]): [number, number, number] {
  const [r, g, b] = [r255, g255, b255].map(v => linearize01(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

/** OKLab [L, a, b] → `#rrggbb`, via the chroma-preserving gamut fit. */
function oklabToHex([okL, okA, okB]: readonly number[]): string {
  return oklchToHex({
    l: okL,
    c: Math.hypot(okA, okB),
    h: ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360
  })
}

/** Raw (possibly out-of-gamut) linear-sRGB triple for an OKLCH color. */
function oklchToRgbRaw({ l: okL, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180
  const okA = c * Math.cos(rad)
  const okB = c * Math.sin(rad)

  const l = (okL + 0.3963377774 * okA + 0.2158037573 * okB) ** 3
  const m = (okL - 0.1055613458 * okA - 0.0638541728 * okB) ** 3
  const s = (okL - 0.0894841775 * okA - 1.291485548 * okB) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

const inSrgbGamut = (rgb: readonly number[]): boolean => rgb.every(c => c >= -0.001 && c <= 1.001)

/**
 * OKLCH → `#rrggbb`, reducing chroma until the color fits sRGB.
 *
 * Clipping the channels instead would shift hue and lightness — a saturated
 * blue clips to a different blue. Binary-searching chroma keeps the hue and the
 * perceived lightness exactly, and only gives up the colorfulness the display
 * cannot show. Deep blues and yellows need this; mid-chroma greens never do.
 */
export function oklchToHex(color: Oklch): string {
  if (inSrgbGamut(oklchToRgbRaw(color))) {
    return toHex(oklchToRgbRaw(color).map(c => delinearize01(c) * 255) as [number, number, number])
  }

  let lo = 0
  let hi = color.c

  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2

    if (inSrgbGamut(oklchToRgbRaw({ ...color, c: mid }))) {
      lo = mid
    } else {
      hi = mid
    }
  }

  return toHex(oklchToRgbRaw({ ...color, c: lo }).map(c => delinearize01(c) * 255) as [number, number, number])
}

/**
 * OKLCH → 0–255 sRGB, or `null` when the color is outside the display's gamut.
 *
 * The picker draws its field with this: a hue slice of OKLCH is a curved wedge
 * in sRGB, not a rectangle, so plotting lightness against chroma needs to know
 * where the wedge ENDS. Rendering the boundary honestly is the difference
 * between a picker where every pixel is a real color and one where a third of
 * the area silently clamps to the same few hexes.
 */
export function oklchToSrgb255(color: Oklch): [number, number, number] | null {
  const raw = oklchToRgbRaw(color)

  if (!inSrgbGamut(raw)) {
    return null
  }

  return raw.map(c => Math.round(Math.min(1, Math.max(0, delinearize01(c))) * 255)) as [number, number, number]
}

/** Largest in-gamut chroma for a lightness+hue, for scaling the picker's axis. */
export function maxChroma(l: number, h: number): number {
  let lo = 0
  let hi = 0.4

  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2

    if (inSrgbGamut(oklchToRgbRaw({ l, c: mid, h }))) {
      lo = mid
    } else {
      hi = mid
    }
  }

  return lo
}

/**
 * Signed shortest angular distance from `from` to `to`, in degrees (-180..180).
 * Hue is a circle: 350° and 10° are 20° apart, not 340°.
 */
export function hueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/**
 * Bend a semantic color toward the accent along the shortest hue arc.
 *
 * A success green next to a blue accent reads as a clash, but recoloring it to
 * the accent throws away the meaning — "done" and "running" become one color.
 * Rotating it PART of the way keeps the semantics and settles the palette: at
 * `strength` 0 nothing moves, at 1 it lands on the accent hue.
 *
 * The default costs nothing by construction: when the accent already is a green
 * (GitHub's 148° vs emerald's 162°) the arc is 14° and a 0.25 rotation moves the
 * dot ~3° — invisible. The work only happens when the accent is genuinely far
 * away, which is exactly the case that was clashing.
 */
export function harmonize(hex: string, accent: string, strength: number): string {
  const base = hexToOklch(hex)
  const target = hexToOklch(accent)

  if (!base || !target) {
    return hex
  }

  // Signed shortest arc, so a green never takes the long way round the wheel.
  const h = (base.h + hueDelta(base.h, target.h) * Math.min(1, Math.max(0, strength)) + 360) % 360

  return oklchToHex({ ...base, c: Math.min(Math.max(base.c, target.c * 0.85), maxChroma(base.l, h)), h })
}

/**
 * Blend two colors in OKLab — the hue-stable counterpart to `mix`.
 *
 * `mix` lerps gamma-encoded sRGB channels, which bends hue on the way: a
 * saturated blue mixed 88% toward white lands 7.6° violet of where it started,
 * which is why a clean blue accent produced a lavender selection row. OKLab is
 * (near) perceptually uniform, so the same blend keeps the hue and just walks
 * chroma and lightness — the soft surface reads as a pale version of the accent
 * instead of a different color.
 *
 * Use this for anything derived from the brand seed. `mix` is still correct for
 * blending neutrals, where there is no hue to preserve.
 */
export function mixOklab(a: string, b: string, amount: number): string {
  const ra = parseColor(a)
  const rb = parseColor(b)

  if (!ra || !rb) {
    return a
  }

  const la = rgbToOklab(ra)
  const lb = rgbToOklab(rb)
  const t = Math.min(1, Math.max(0, amount))

  return oklabToHex([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t])
}

/** Re-hue a color, holding its perceived lightness and colorfulness. */
export function withHue(hex: string, hue: number): string {
  const lch = hexToOklch(hex)

  return lch ? oklchToHex({ ...lch, h: ((hue % 360) + 360) % 360 }) : hex
}

/**
 * Make `hex` clear `min` contrast against `bg` by moving its LIGHTNESS only.
 *
 * The sRGB-mixing version of this (`ensureContrast`) blends toward white or
 * black, which drags chroma down with it — Nous blue `#0053FD` mixed 30% white
 * to pass AA on a dark surface loses a third of its colorfulness and reads
 * washed. Walking OKLCH lightness instead keeps hue and chroma intact, so a
 * brand color stays recognizably itself at whatever lightness the surface
 * demands. Returns the original when it already passes, and gives up at the
 * ends of the lightness range rather than looping.
 */
export function ensureContrastOklch(hex: string, bg: string, min: number): string {
  const ratio = contrastRatio(hex, bg)

  if (ratio === null || ratio >= min) {
    return hex
  }

  const lch = hexToOklch(hex)

  if (!lch) {
    return hex
  }

  // Lighten on a dark backdrop, darken on a light one.
  const up = (relativeLuminance(bg) ?? 0) < 0.5
  let best = hex

  for (let step = 1; step <= 40; step += 1) {
    const l = lch.l + (up ? step : -step) * 0.02

    if (l <= 0 || l >= 1) {
      break
    }

    best = oklchToHex({ ...lch, l })

    if ((contrastRatio(best, bg) ?? 0) >= min) {
      return best
    }
  }

  return best
}
