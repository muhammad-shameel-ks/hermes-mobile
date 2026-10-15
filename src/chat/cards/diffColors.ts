/**
 * The desktop's `--ui-diff-*` tokens, resolved per rendered mode (styles.css
 * :root and :root.dark): the add and remove borders are `--ui-green` and
 * `--ui-red`, the tints are 12% of them, and the text mixes toward black in
 * light and white in dark. They depend on the mode only, never on the skin.
 */

import { mixPct } from '../../ui/color.ts';
import type { Mode } from '../../ui/tokens.ts';

const PALETTE = {
  light: { green: '#1f8a65', red: '#cf2d56' },
  dark: { green: '#55a583', red: '#e75e78' },
} as const;

export type DiffColors = {
  green: string;
  red: string;
  addBorder: string;
  addBackground: string;
  addForeground: string;
  removeBorder: string;
  removeBackground: string;
  removeForeground: string;
};

export function diffColors(mode: Mode): DiffColors {
  const { green, red } = PALETTE[mode];
  const text = (color: string) => (mode === 'dark' ? mixPct(color, 0.62, '#ffffff') : mixPct(color, 0.7, '#000000'));
  return {
    green,
    red,
    addBorder: green,
    addBackground: mixPct(green, 0.12, 'transparent'),
    addForeground: text(green),
    removeBorder: red,
    removeBackground: mixPct(red, 0.12, 'transparent'),
    removeForeground: text(red),
  };
}
