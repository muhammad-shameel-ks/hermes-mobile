/**
 * A profile's mark (apps/desktop/src/components/ui/profile-glyph.tsx, lib/profile-color.ts): the default
 * profile is the home icon, every other a soft tint of its colour carrying its initial.
 */

import { mixPct, normalizeHex } from '../ui/color.ts';

/** `hsl(h, s%, l%)` as a hex, which `mixPct` can tint */
export function hslToHex(color: string): string | null {
  const match = /^hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%\s*\)$/i.exec(color.trim());
  if (!match) return normalizeHex(color);
  const h = Number(match[1]) % 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[0, 8, 4].map((n) => channel(n).toString(16).padStart(2, '0')).join('')}`;
}

/** `profileColorSoft`: the profile's colour at `percent` over nothing, for a tag's fill */
export function profileColorSoft(color: string, percent = 22): string {
  const hex = hslToHex(color);
  return hex ? mixPct(hex, percent / 100, 'transparent') : 'transparent';
}

/** the first letter, number or emoji of the label, as the rail's square carries it */
export function profileInitial(label: string): string {
  for (const char of Array.from(label.trim())) if (/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(char)) return char.toUpperCase();
  return '?';
}
