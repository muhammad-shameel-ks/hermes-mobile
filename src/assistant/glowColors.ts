/** the four colours travelling round the edge glow: the skin's accents, with a purple and a cyan pulled toward them */

import { harmonize, normalizeHex } from '../ui/color.ts';
import type { Tokens } from '../ui/tokens.ts';

const cache = new WeakMap<Tokens, readonly string[]>();

export function glowColors(t: Tokens): readonly string[] {
  let colors = cache.get(t);
  if (!colors) {
    const accent = normalizeHex(t.uiAccent) ?? '#7c8cff';
    colors = [
      accent,
      harmonize(normalizeHex(t.uiPurple) ?? '#a855f7', accent, 0.35),
      normalizeHex(t.uiAccentSecondary) ?? accent,
      harmonize(normalizeHex(t.uiCyan) ?? '#22d3ee', accent, 0.35),
    ];
    cache.set(t, colors);
  }
  return colors;
}
