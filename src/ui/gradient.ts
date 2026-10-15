/** Sampling a multi-stop gradient along a run of text (see GradientText.tsx). */

import { mixPct } from './color.ts';

/** a stop: where along the run (0–1) and the colour there */
export type GradientStop = readonly [at: number, color: string];

/** the colour at `x` (0–1) between the surrounding stops */
export function gradientAt(stops: readonly GradientStop[], x: number): string {
  if (stops.length === 0) return 'transparent';
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [at, color] = stops[i];
    if (x <= at) {
      const [prevAt, prevColor] = stops[i - 1];
      const span = at - prevAt;
      return mixPct(color, span <= 0 ? 1 : (x - prevAt) / span, prevColor);
    }
  }
  return stops[stops.length - 1][1];
}

/** one colour per character, sampled at the character's centre */
export function gradientColors(text: string, stops: readonly GradientStop[]): Array<{ char: string; color: string }> {
  const chars = Array.from(text);
  return chars.map((char, index) => ({ char, color: gradientAt(stops, chars.length <= 1 ? 0 : (index + 0.5) / chars.length) }));
}
