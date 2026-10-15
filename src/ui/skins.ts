/**
 * The skins the phone offers and the palette each paints in a mode, mirroring
 * apps/desktop/src/themes (presets.ts, accents.ts and the palette half of
 * context.tsx): the 11 shared skins, the synthesised light twin for skins that
 * ship only a dark palette, the accent override and the rendered-mode derivation.
 * The desktop-only `classic` skin and backend skins are dropped.
 */

import { mix, parseColor } from '../../vendor/hermes-shared/src/color.ts';
import { THEME_PRESET_PALETTES, type ThemePresetColors, type ThemePresetName } from '../../vendor/hermes-shared/src/theme-presets.ts';
import { normalizeHex, readableInk } from './color.ts';
import { retintPalette } from './retint.ts';

export type Mode = 'light' | 'dark';
export type ModePreference = 'system' | Mode;
export type SkinName = ThemePresetName;

export const DEFAULT_SKIN: SkinName = 'nous';

/** Names that no longer resolve to a skin of their own; a stored pick falls back to the default. */
const RETIRED_SKINS = new Set(['nous-light', 'default', 'gold', 'classic']);

export type SkinInfo = { name: SkinName; label: string; description: string };

export const SKINS: readonly SkinInfo[] = [
  { name: 'nous', label: 'Nous', description: 'GitHub chrome, Nous blue accent' },
  { name: 'github', label: 'GitHub', description: 'GitHub Light Default and Dark Default' },
  { name: 'catppuccin', label: 'Catppuccin', description: 'Soothing pastels — Latte and Mocha' },
  { name: 'everforest', label: 'Everforest', description: 'Warm, low-contrast forest greens' },
  { name: 'solarized', label: 'Solarized', description: 'Fixed-contrast light and dark' },
  { name: 'nous-alt', label: 'Nous Alt', description: 'Glass neutrals, cream on mission-blue' },
  { name: 'midnight', label: 'Midnight', description: 'Deep blue-violet with cool accents' },
  { name: 'ember', label: 'Ember', description: 'Warm crimson and bronze — forge vibes' },
  { name: 'mono', label: 'Mono', description: 'Clean grayscale — minimal and focused' },
  { name: 'cyberpunk', label: 'Cyberpunk', description: 'Neon green on black — matrix terminal' },
  { name: 'slate', label: 'Slate', description: 'Cool slate blue — focused developer theme' },
];

export const isSkinName = (value: unknown): value is SkinName => typeof value === 'string' && Object.hasOwn(THEME_PRESET_PALETTES, value);

export const normalizeSkin = (value: unknown): SkinName =>
  isSkinName(value) && !RETIRED_SKINS.has(value) ? value : DEFAULT_SKIN;

export const normalizeModePreference = (value: unknown): ModePreference =>
  value === 'light' || value === 'dark' || value === 'system' ? value : 'system';

/** `system` follows the platform appearance; an explicit pick wins. */
export const resolveMode = (preference: ModePreference, systemDark: boolean): Mode =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

/** A light twin for a skin that ships only a dark palette (context.tsx `synthLightColors`). */
function synthLightColors(seed: ThemePresetColors): ThemePresetColors {
  const accent = seed.ring || seed.primary;
  const soft = mix('#ffffff', accent, 0.1);
  const softer = mix('#ffffff', accent, 0.06);
  const border = mix('#ececef', accent, 0.14);
  const midground = seed.midground ?? accent;

  return {
    background: '#ffffff',
    foreground: '#161616',
    card: '#ffffff',
    cardForeground: '#161616',
    muted: softer,
    mutedForeground: mix('#6b6b70', accent, 0.16),
    popover: '#ffffff',
    popoverForeground: '#161616',
    primary: accent,
    primaryForeground: readableInk(accent),
    secondary: soft,
    secondaryForeground: mix('#2a2a2a', accent, 0.34),
    accent: soft,
    accentForeground: mix('#2a2a2a', accent, 0.34),
    border,
    input: mix('#e2e2e6', accent, 0.18),
    ring: accent,
    midground,
    midgroundForeground: readableInk(midground),
    destructive: '#b94a3a',
    destructiveForeground: '#ffffff',
    sidebarBackground: mix('#fafafa', accent, 0.05),
    sidebarBorder: border,
    userBubble: soft,
    userBubbleBorder: border,
  };
}

type Preset = { colors: ThemePresetColors; darkColors?: ThemePresetColors };

const presetOf = (skin: SkinName): Preset => THEME_PRESET_PALETTES[skin];

function paletteFor(seed: Preset, mode: Mode): ThemePresetColors {
  if (mode === 'dark') return seed.darkColors ?? seed.colors;
  return seed.darkColors ? seed.colors : synthLightColors(seed.colors);
}

/** The seed palette for a skin and mode, no accent override applied (`getBaseColors`). */
export const baseColors = (skin: SkinName, mode: Mode): ThemePresetColors => paletteFor(presetOf(skin), mode);

/**
 * The palette a skin paints in a mode with an accent override on top. The
 * override moves only the accent family, each mode retinted from its own base
 * palette; the skin's own accent, or no override, returns the base palette.
 */
export function paletteWithAccent(skin: SkinName, mode: Mode, accent: string | null): ThemePresetColors {
  const base = presetOf(skin);
  const hex = accent === null ? null : normalizeHex(accent);
  if (!hex || hex === normalizeHex(base.colors.primary)) return paletteFor(base, mode);
  return retintPalette(paletteFor(base, mode), hex);
}

/**
 * Some palettes keep a bright background in "dark" (and the reverse), so the
 * mode painted is decided from the actual background's luminance.
 */
export function renderedModeFor(colors: Pick<ThemePresetColors, 'background'>, mode: Mode): Mode {
  const rgb = parseColor(colors.background);
  if (!rgb) return mode;
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
}

export const NOUS_ACCENT = '#0053fd';

type Swatch = { id: string; name: string; light: string; dark: string };

const SWATCHES: readonly Swatch[] = [
  { id: 'mono', name: 'Mono', light: '#000000', dark: '#ffffff' },
  { id: 'green', name: 'GitHub green', light: '#2ea043', dark: '#2ea043' },
  { id: 'cyan', name: 'Cyber cyan', light: '#00d5ff', dark: '#00d5ff' },
  { id: 'nous', name: 'Nous blue', light: NOUS_ACCENT, dark: NOUS_ACCENT },
  { id: 'violet', name: 'Ultraviolet', light: '#8a2be2', dark: '#8a2be2' },
  { id: 'pink', name: 'Barbie pink', light: '#e0218a', dark: '#e0218a' },
  { id: 'red', name: 'Electric red', light: '#ff073a', dark: '#ff073a' },
  { id: 'orange', name: 'Safety orange', light: '#ff6a00', dark: '#ff6a00' },
];

export type AccentSwatch = { id: string; name: string; hex: string };

/** The accent swatches as painted in a rendered mode (Mono is black on light, white on dark). */
export const accentsFor = (mode: Mode): AccentSwatch[] =>
  SWATCHES.map(({ id, name, light, dark }) => ({ id, name, hex: mode === 'dark' ? dark : light }));
