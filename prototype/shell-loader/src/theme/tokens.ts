/**
 * The `nous` skin's runtime token set, ported from the desktop so the
 * prototype reads the same type/radius/colour ladder on device.
 *
 * Ported tokens and their sources — every value is resolved the way the desktop
 * resolves it at runtime, not read off a screenshot:
 *
 * seeds / ratio knobs (styles.css:206-237, `applyTheme` context.tsx:334-372)
 *   uiBase               ← --theme-foreground ← palette.foreground
 *   uiAccent             ← --theme-midground ← palette.midground ?? ring
 *   uiAccentSecondary    ← --theme-primary    ← palette.primary
 *   uiWarm               ← --theme-warm       ← palette.primary (runtime)
 *   mix knobs (chrome/sidebar/card/elevated/bubble) ← mixesFor(isDark)
 *
 * derived ladder (styles.css:239-420), via `mixPct` = `color-mix(in srgb, …)`
 *   uiBgChrome/Sidebar/Editor/Elevated  ← seed × mix-knob over neutral
 *   uiBgCard                            ← accent 4% over base 4%-transparent
 *   uiBgPrimary/Secondary/Tertiary      ← accent fill-mix over base% transparent
 *   uiRowHover/Active, uiControlHover   ← accent mix over base% transparent
 *   uiTextPrimary…Quaternary            ← base 94/74/54/36% transparent
 *   uiStrokePrimary…Quaternary          ← accent stroke-mix over base% transparent
 *   uiSurface/SidebarSurface/ChatSurface← editor/sidebar/chrome background
 *   uiWidgetSurfaceBackground           ← editor bg (dark: 88% over #000)
 *   uiChatBubbleBackground              ← bubble seed × bubble-mix over neutral card
 *   uiSelectionBackground               ← #ffd24a 55% (dark 38%) transparent
 *   uiBgInput                           ← #fcfcfc
 *
 * dark overrides (styles.css:600-635)
 *   mix knobs 74/38/46/46%, neutral chrome #0d0d0e / sidebar #0a0a0b / card #161618,
 *   uiSelectionBackground 38%, uiWidgetSurfaceBackground = editor bg 88% over #000
 *
 * runtime (applyTheme, context.tsx:334-372)
 *   dtPrimarySolid          ← ensureContrast(palette.primary, '#fcfcfc', 4.5)
 *   dtPrimarySolidForeground← '#fcfcfc'
 *   dtDestructive           ← palette.destructive
 *   uiSuccess               ← harmonize('#10b981', midground, 0.25)
 *
 * Approximations / notes:
 *  - uiWarm: the `:root` fallback for --theme-warm is `#cf806d`, but `applyTheme`
 *    overwrites it with `palette.primary` at runtime. The runtime value wins, so
 *    uiWarm = primary (both appearances).
 *  - mixPct round-trips through `Math.round` on the alpha byte: the ticket's
 *    illustrative `mixPct('#0053fd', 0.74, 'transparent')` → `#0053fdbc` lands on
 *    `#0053fdbd` under round-half-up (0.74 × 255 = 188.7). Colour is unchanged and
 *    alpha still equals p; only the last byte's rounding differs.
 *  - uiBgInput has no dark override in styles.css, so it is #fcfcfc in both modes.
 *  - dtPrimarySolid uses the SHARED sRGB `ensureContrast` (context.tsx imports it
 *    from `@hermes/shared/color`), not the desktop OKLCH `ensureContrastOklch`.
 */

import { ensureContrast, harmonize, luminance, mixPct } from './color'

export type Mode = 'light' | 'dark'

export interface Tokens {
  mode: Mode
  renderedMode: Mode
  uiBgChrome: string; uiBgSidebar: string; uiBgEditor: string; uiBgElevated: string; uiBgCard: string; uiBgInput: string
  uiSurfaceBackground: string; uiSidebarSurfaceBackground: string; uiChatSurfaceBackground: string; uiWidgetSurfaceBackground: string
  uiChatBubbleBackground: string
  uiTextPrimary: string; uiTextSecondary: string; uiTextTertiary: string; uiTextQuaternary: string
  uiStrokePrimary: string; uiStrokeSecondary: string; uiStrokeTertiary: string; uiStrokeQuaternary: string
  uiBgPrimary: string; uiBgSecondary: string; uiBgTertiary: string; uiRowHoverBackground: string; uiRowActiveBackground: string; uiControlHoverBackground: string
  uiBase: string; uiAccent: string; uiAccentSecondary: string; uiWarm: string; uiSuccess: string
  dtPrimarySolid: string; dtPrimarySolidForeground: string; dtDestructive: string; uiSelectionBackground: string
  radius: { xs: number; sm: number; md: number; lg: number; xl: number; full: number }
  type: { base: number; text: number; tool: number; caption: number; lineHeight: number; captionLineHeight: number; lineHeightRatio: number; letterSpacing: number }
  font: { sans: string | undefined; mono: string }
}

/** Default chat text size (`chat-text-scale.ts` DEFAULT_CHAT_TEXT_SCALE = 110). */
export const CHAT_TEXT_SCALE = 1.1

// palette: apps/shared/src/theme-presets.ts entry `nous`.
const NOUS = {
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    card: '#f6f8fa',
    popover: '#ffffff',
    primary: '#0053fd',
    destructive: '#cf222e',
    sidebarBackground: '#f6f8fa',
    userBubble: '#dae7fd',
    midground: '#0053fd'
  },
  dark: {
    background: '#0d1117',
    foreground: '#e6edf3',
    card: '#010409',
    popover: '#161b22',
    primary: '#4a84fe',
    destructive: '#f85149',
    sidebarBackground: '#010409',
    userBubble: '#07162c',
    midground: '#4a84fe'
  }
} as const

// styles.css `:root` (light) and `:root.dark` neutrals + mix knobs.
const LIGHT = {
  chrome: '#f3f3f3',
  sidebar: '#f3f3f3',
  card: '#fcfcfc',
  mixChrome: 0.92,
  mixSidebar: 1,
  mixCard: 0.22,
  mixElevated: 0.28,
  mixBubble: 0
} as const

const DARK = {
  chrome: '#0d0d0e',
  sidebar: '#0a0a0b',
  card: '#161618',
  mixChrome: 0.74,
  mixSidebar: 1,
  mixCard: 0.38,
  mixElevated: 0.46,
  mixBubble: 0.46
} as const

const cache = new Map<string, Tokens>()

/** The memoised `nous` token set for an appearance at a chat text scale. */
export function resolveTokens(mode: Mode, chatTextScale = CHAT_TEXT_SCALE): Tokens {
  const key = `${mode}|${chatTextScale}`
  const cached = cache.get(key)

  if (cached) {
    return cached
  }

  const palette = mode === 'dark' ? NOUS.dark : NOUS.light
  const renderedMode = luminance(palette.background) > 0.5 ? 'light' : 'dark'
  const isDark = renderedMode === 'dark'

  const neutral = isDark ? DARK : LIGHT
  const base = palette.foreground
  const accent: string = palette.midground

  const uiBgEditor = mixPct(palette.card, neutral.mixCard, neutral.card)

  const tokens: Tokens = {
    mode,
    renderedMode,

    uiBgChrome: mixPct(palette.background, neutral.mixChrome, neutral.chrome),
    uiBgSidebar: mixPct(palette.sidebarBackground, neutral.mixSidebar, neutral.sidebar),
    uiBgEditor,
    uiBgElevated: mixPct(palette.popover, neutral.mixElevated, neutral.card),
    uiBgCard: mixPct(accent, 0.04, mixPct(base, 0.04, 'transparent')),
    uiBgInput: '#fcfcfc',

    uiSurfaceBackground: uiBgEditor,
    uiSidebarSurfaceBackground: mixPct(palette.sidebarBackground, neutral.mixSidebar, neutral.sidebar),
    uiChatSurfaceBackground: mixPct(palette.background, neutral.mixChrome, neutral.chrome),
    uiWidgetSurfaceBackground: isDark ? mixPct(uiBgEditor, 0.88, '#000000') : uiBgEditor,

    uiChatBubbleBackground: mixPct(palette.userBubble, neutral.mixBubble, neutral.card),

    uiTextPrimary: mixPct(base, 0.94, 'transparent'),
    uiTextSecondary: mixPct(base, 0.74, 'transparent'),
    uiTextTertiary: mixPct(base, 0.54, 'transparent'),
    uiTextQuaternary: mixPct(base, 0.36, 'transparent'),

    uiStrokePrimary: mixPct(accent, 0.24, mixPct(base, 0.1, 'transparent')),
    uiStrokeSecondary: mixPct(accent, 0.16, mixPct(base, 0.07, 'transparent')),
    uiStrokeTertiary: mixPct(accent, 0.1, mixPct(base, 0.05, 'transparent')),
    uiStrokeQuaternary: mixPct(accent, 0.06, mixPct(base, 0.03, 'transparent')),

    uiBgPrimary: mixPct(accent, 0.16, mixPct(base, 0.1, 'transparent')),
    uiBgSecondary: mixPct(accent, 0.11, mixPct(base, 0.07, 'transparent')),
    uiBgTertiary: mixPct(accent, 0.08, mixPct(base, 0.05, 'transparent')),
    uiRowHoverBackground: mixPct(accent, 0.04, mixPct(base, 0.03, 'transparent')),
    uiRowActiveBackground: mixPct(accent, 0.08, mixPct(base, 0.05, 'transparent')),
    uiControlHoverBackground: mixPct(accent, 0.06, mixPct(base, 0.04, 'transparent')),

    uiBase: base,
    uiAccent: accent,
    uiAccentSecondary: palette.primary,
    uiWarm: palette.primary,
    uiSuccess: harmonize('#10b981', accent, 0.25),

    dtPrimarySolid: ensureContrast(palette.primary, '#fcfcfc', 4.5),
    dtPrimarySolidForeground: '#fcfcfc',
    dtDestructive: palette.destructive,
    uiSelectionBackground: mixPct('#ffd24a', isDark ? 0.38 : 0.55, 'transparent'),

    // --radius-scalar: 0.2 × styles.css radius ladder, in dp (rem × 16).
    radius: { xs: 0.4, sm: 1.6, md: 2, lg: 2.4, xl: 3.2, full: 9999 },

    // body font-size 13px; conversation base sizes × --chat-text-scale.
    type: {
      base: 13,
      text: 13 * chatTextScale,
      tool: 11 * chatTextScale,
      caption: 12 * chatTextScale,
      lineHeight: 18 * chatTextScale,
      captionLineHeight: 16 * chatTextScale,
      lineHeightRatio: 1.5,
      letterSpacing: 0
    },

    font: { sans: undefined, mono: 'JetBrainsMono_400Regular' }
  }

  cache.set(key, tokens)

  return tokens
}
