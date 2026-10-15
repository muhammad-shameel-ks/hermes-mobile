/**
 * The desktop's semantic palette (styles.css `--ui-red/green/yellow/blue` and the
 * `--ui-diff-*` ladder derived from green and red), which tokens.ts does not carry
 * yet. Light values in :root, the dark overrides in :root.dark.
 */

import type { Tokens } from '../ui/tokens.ts';
import { mixPct } from '../ui/color.ts';

const LIGHT = { red: '#cf2d56', yellow: '#c08532', green: '#1f8a65', blue: '#0053fd' } as const;
const DARK = { red: '#e75e78', yellow: '#c08532', green: '#55a583', blue: '#0053fd' } as const;

function resolvePalette(mode: Tokens['renderedMode']) {
  const dark = mode === 'dark';
  const base = dark ? DARK : LIGHT;
  return {
    ...base,
    diffAddBorder: base.green,
    diffAddBackground: mixPct(base.green, 0.12, 'transparent'),
    diffAddForeground: dark ? mixPct(base.green, 0.62, '#ffffff') : mixPct(base.green, 0.7, '#000000'),
    diffRemoveBorder: base.red,
    diffRemoveBackground: mixPct(base.red, 0.12, 'transparent'),
    diffRemoveForeground: dark ? mixPct(base.red, 0.62, '#ffffff') : mixPct(base.red, 0.7, '#000000'),
    // review rows tint modified and renamed files with tailwind's amber-500 / sky-500 at 85%
    statusModified: mixPct('#f59e0b', 0.85, 'transparent'),
    statusRenamed: mixPct('#0ea5e9', 0.85, 'transparent'),
  };
}

export type Palette = ReturnType<typeof resolvePalette>;

const cache = new Map<string, Palette>();

export function paletteFor(t: Pick<Tokens, 'renderedMode'>): Palette {
  let palette = cache.get(t.renderedMode);
  if (!palette) {
    palette = resolvePalette(t.renderedMode);
    cache.set(t.renderedMode, palette);
  }
  return palette;
}
