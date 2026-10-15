/**
 * The `nous` skin's resolved theme, computed the way the desktop computes it at
 * runtime (issue "Theme and typography emulation on React Native"): seeds from
 * the vendored preset palette, the styles.css neutral mix knobs, and the derived
 * ladder via `mixPct` in place of CSS `color-mix`. Token names are the desktop's.
 *
 * Sources: apps/desktop/src/styles.css (:root and :root.dark ladders) and
 * themes/context.tsx `applyTheme`; ported first in prototype/shell-loader.
 * One skin and no settings yet - the skin picker and Chat Text Size arrive with
 * the appearance work.
 */

import { createContext, useContext } from 'react';

import { ensureContrast } from '../../vendor/hermes-shared/src/color.ts';
import { THEME_PRESET_PALETTES } from '../../vendor/hermes-shared/src/theme-presets.ts';
import { harmonize, luminance, mixPct } from './color.ts';

export type Mode = 'light' | 'dark';

/** Default Chat Text Size (desktop `DEFAULT_CHAT_TEXT_SCALE` = 110). */
export const CHAT_TEXT_SCALE = 1.1;

/** desktop styles.css `[data-conversation-scaffold]` resting fade, so prose stays primary */
export const SCAFFOLD_OPACITY = 0.67;

const NEUTRALS = {
  light: { chrome: '#f3f3f3', sidebar: '#f3f3f3', card: '#fcfcfc', mixChrome: 0.92, mixSidebar: 1, mixCard: 0.22, mixElevated: 0.28, mixBubble: 0 },
  dark: { chrome: '#0d0d0e', sidebar: '#0a0a0b', card: '#161618', mixChrome: 0.74, mixSidebar: 1, mixCard: 0.38, mixElevated: 0.46, mixBubble: 0.46 },
} as const;

export const MONO = 'JetBrainsMono_400Regular';
export const MONO_MEDIUM = 'JetBrainsMono_500Medium';
/** desktop `.wordmark`: Blaze Type's Collapse Bold, converted from the desktop's woff2 */
export const WORDMARK_FONT = 'Collapse-Bold';
/** VS Code codicons, the desktop's composer and menu glyphs */
export const CODICON_FONT = 'codicon';

function resolve(mode: Mode, chatTextScale: number) {
  const preset = THEME_PRESET_PALETTES.nous;
  const palette = mode === 'dark' ? (preset.darkColors ?? preset.colors) : preset.colors;
  const renderedMode: Mode = luminance(palette.background) > 0.5 ? 'light' : 'dark';
  const neutral = NEUTRALS[renderedMode];
  const base = palette.foreground;
  const accent = palette.midground ?? palette.ring;
  const sidebarSeed = palette.sidebarBackground ?? palette.card;
  const uiBgEditor = mixPct(palette.card, neutral.mixCard, neutral.card);
  const isDark = renderedMode === 'dark';

  return {
    mode,
    renderedMode,

    uiBgChrome: mixPct(palette.background, neutral.mixChrome, neutral.chrome),
    uiBgSidebar: mixPct(sidebarSeed, neutral.mixSidebar, neutral.sidebar),
    uiBgEditor,
    uiBgElevated: mixPct(palette.popover, neutral.mixElevated, neutral.card),
    uiBgCard: mixPct(accent, 0.04, mixPct(base, 0.04, 'transparent')),
    uiChatSurfaceBackground: mixPct(palette.background, neutral.mixChrome, neutral.chrome),
    uiWidgetSurfaceBackground: isDark ? mixPct(uiBgEditor, 0.88, '#000000') : uiBgEditor,
    uiChatBubbleBackground: mixPct(palette.userBubble ?? palette.card, neutral.mixBubble, neutral.card),

    /** solid `--foreground` / `--background`: the composer's primary button paints with these */
    dtForeground: base,
    dtBackground: palette.background,
    uiTextPrimary: mixPct(base, 0.94, 'transparent'),
    uiTextSecondary: mixPct(base, 0.74, 'transparent'),
    uiTextTertiary: mixPct(base, 0.54, 'transparent'),
    uiTextQuaternary: mixPct(base, 0.36, 'transparent'),
    /** thinking headers and tool rows: one grey for all of them, faded by SCAFFOLD_OPACITY */
    conversationScaffoldText: mixPct(base, 0.64, 'transparent'),
    conversationScaffoldMeta: mixPct(base, 0.44, 'transparent'),
    // desktop `.wordmark`: text-foreground/90 when dark, the accent when light
    uiWordmark: isDark ? mixPct(base, 0.9, 'transparent') : accent,

    uiStrokePrimary: mixPct(accent, 0.24, mixPct(base, 0.1, 'transparent')),
    uiStrokeSecondary: mixPct(accent, 0.16, mixPct(base, 0.07, 'transparent')),
    uiStrokeTertiary: mixPct(accent, 0.1, mixPct(base, 0.05, 'transparent')),
    uiStrokeQuaternary: mixPct(accent, 0.06, mixPct(base, 0.03, 'transparent')),

    uiBgPrimary: mixPct(accent, 0.16, mixPct(base, 0.1, 'transparent')),
    uiBgSecondary: mixPct(accent, 0.11, mixPct(base, 0.07, 'transparent')),
    uiBgTertiary: mixPct(accent, 0.08, mixPct(base, 0.05, 'transparent')),
    uiRowActiveBackground: mixPct(accent, 0.08, mixPct(base, 0.05, 'transparent')),
    uiControlActiveBackground: mixPct(accent, 0.08, mixPct(base, 0.05, 'transparent')),
    uiControlHoverBackground: mixPct(accent, 0.06, mixPct(base, 0.04, 'transparent')),

    uiAccent: accent,
    uiComposerRing: palette.composerRing ?? accent,
    uiSuccess: harmonize('#10b981', accent, 0.25),
    /** desktop `--ui-purple`: subagent glyphs */
    uiPurple: '#9e94d5',
    dtPrimarySolid: ensureContrast(palette.primary, '#fcfcfc', 4.5),
    dtPrimarySolidForeground: '#fcfcfc',
    dtDestructive: palette.destructive,
    uiSelectionBackground: mixPct('#ffd24a', isDark ? 0.38 : 0.55, 'transparent'),
    scrim: 'rgba(0, 0, 0, 0.22)',

    // --radius-scalar 0.2 × the styles.css ladder, 1:1 in dp (issue "Shell and loader prototype on device").
    radius: { xs: 0.4, sm: 1.6, md: 2, lg: 2.4, xl: 3.2, '2xl': 4.8, '3xl': 6.4, '4xl': 8, full: 9999 },

    // body 13px; the five conversation tokens scale with Chat Text Size.
    type: {
      base: 13,
      text: 13 * chatTextScale,
      tool: 11 * chatTextScale,
      caption: 12 * chatTextScale,
      lineHeight: 18 * chatTextScale,
      captionLineHeight: 16 * chatTextScale,
    },
  };
}

export type Tokens = ReturnType<typeof resolve>;

const cache = new Map<string, Tokens>();

export function resolveTokens(mode: Mode, chatTextScale = CHAT_TEXT_SCALE): Tokens {
  const key = `${mode}|${chatTextScale}`;
  let tokens = cache.get(key);
  if (!tokens) {
    tokens = resolve(mode, chatTextScale);
    cache.set(key, tokens);
  }
  return tokens;
}

export const TokensContext = createContext<Tokens>(resolveTokens('dark'));

export const useTokens = () => useContext(TokensContext);
