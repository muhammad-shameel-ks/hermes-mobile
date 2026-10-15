/**
 * The resolved theme, computed the way the desktop computes it at runtime
 * (issue "Theme and typography emulation on React Native"): the skin's palette
 * for a mode (with the accent override), the seed tokens, the styles.css
 * neutral and ratio knobs, and the derived ladder via `mixPct` in place of CSS
 * `color-mix`. Token names are the desktop's, camel-cased.
 *
 * Sources: apps/desktop/src/styles.css (:root and :root.dark ladders) and
 * themes/context.tsx `applyTheme`. Chat Text Size multiplies only the five
 * conversation tokens; chrome type never scales.
 */

import { createContext, useContext } from 'react';

import { ensureContrast } from '../../vendor/hermes-shared/src/color.ts';
import { harmonize, hexToOklch, mixPct, oklchToHex, readableInk } from './color.ts';
import { DEFAULT_SKIN, paletteWithAccent, renderedModeFor, type Mode, type SkinName } from './skins.ts';

export type { Mode };

/** Default Chat Text Size (desktop `DEFAULT_CHAT_TEXT_SCALE` = 110). */
export const CHAT_TEXT_SCALE = 1.1;

/** desktop styles.css `[data-conversation-scaffold]` resting fade, so prose stays primary */
export const SCAFFOLD_OPACITY = 0.67;

// styles.css `--theme-neutral-*` and `--theme-mix-*` per rendered mode (mixesFor in context.tsx)
const NEUTRALS = {
  light: { chrome: '#f3f3f3', sidebar: '#f3f3f3', card: '#fcfcfc', mixChrome: 0.92, mixSidebar: 1, mixCard: 0.22, mixElevated: 0.28, mixBubble: 0 },
  dark: { chrome: '#0d0d0e', sidebar: '#0a0a0b', card: '#161618', mixChrome: 0.74, mixSidebar: 1, mixCard: 0.38, mixElevated: 0.46, mixBubble: 0.46 },
} as const;

// styles.css semantic palette: :root, with the `.dark` overrides for red, green and cyan
const SEMANTIC = {
  light: { red: '#cf2d56', orange: '#db704b', yellow: '#c08532', green: '#1f8a65', cyan: '#4c7f8c', blue: '#0053fd', purple: '#9e94d5' },
  dark: { red: '#e75e78', orange: '#db704b', yellow: '#c08532', green: '#55a583', cyan: '#6f9ba6', blue: '#0053fd', purple: '#9e94d5' },
} as const;

// The one foreground --dt-primary-solid is built to carry (context.tsx PRIMARY_SOLID_FOREGROUND)
const PRIMARY_SOLID_FOREGROUND = '#fcfcfc';

export const MONO = 'JetBrainsMono_400Regular';
export const MONO_MEDIUM = 'JetBrainsMono_500Medium';
export const MONO_BOLD = 'JetBrainsMono_700Bold';
export const MONO_ITALIC = 'JetBrainsMono_400Regular_Italic';
/** desktop `.wordmark`: Blaze Type's Collapse Bold, converted from the desktop's woff2 */
export const WORDMARK_FONT = 'Collapse-Bold';
/** VS Code codicons, the desktop's composer and menu glyphs */
export const CODICON_FONT = 'codicon';

export type ThemeSpec = {
  skin?: SkinName;
  /** the light/dark switch after `system` is resolved */
  mode: Mode;
  /** accent override hex, or null for the skin's own */
  accent?: string | null;
  /** Chat Text Size as a multiplier: 1.1 is the 110% default */
  chatTextScale?: number;
  /** the platform's font scale, folded into the conversation tokens only */
  fontScale?: number;
};

function resolve({ skin = DEFAULT_SKIN, mode, accent = null, chatTextScale = CHAT_TEXT_SCALE, fontScale = 1 }: ThemeSpec) {
  const palette = paletteWithAccent(skin, mode, accent);
  const renderedMode = renderedModeFor(palette, mode);
  const neutral = NEUTRALS[renderedMode];
  const semantic = SEMANTIC[renderedMode];
  const isDark = renderedMode === 'dark';
  const base = palette.foreground;
  const midground = palette.midground ?? palette.ring;
  const sidebarSeed = palette.sidebarBackground ?? palette.background;
  const bubbleSeed = palette.userBubble ?? palette.popover;

  const fill = (accentMix: number, baseAlpha: number) => mixPct(midground, accentMix, mixPct(base, baseAlpha, 'transparent'));
  const uiBgChrome = mixPct(palette.background, neutral.mixChrome, neutral.chrome);
  const uiBgSidebar = mixPct(sidebarSeed, neutral.mixSidebar, neutral.sidebar);
  const uiBgEditor = mixPct(palette.card, neutral.mixCard, neutral.card);
  const uiBgElevated = mixPct(palette.popover, neutral.mixElevated, neutral.card);
  const uiBgTertiary = fill(0.08, 0.05);
  const uiRowActiveBackground = fill(0.08, 0.05);
  const uiChatBubbleBackground = mixPct(bubbleSeed, neutral.mixBubble, neutral.card);
  const uiTextPrimary = mixPct(base, 0.94, 'transparent');
  const uiTextTertiary = mixPct(base, 0.54, 'transparent');
  const effective = chatTextScale * fontScale;
  const thumb = hexToOklch(midground);

  return {
    skin,
    mode,
    renderedMode,
    chatTextScale,

    uiBgChrome,
    uiBgSidebar,
    uiBgEditor,
    uiBgElevated,
    uiBgCard: mixPct(midground, 0.04, mixPct(base, 0.04, 'transparent')),
    uiBgInput: '#fcfcfc',
    uiChatSurfaceBackground: uiBgChrome,
    uiWidgetSurfaceBackground: isDark ? mixPct(uiBgEditor, 0.88, '#000000') : uiBgEditor,
    uiChatBubbleBackground,
    uiChatBubbleOpaqueBackground: uiBgEditor,

    /** solid `--foreground` / `--background`: the composer's primary button paints with these */
    dtForeground: base,
    dtBackground: palette.background,
    uiBase: base,
    uiTextPrimary,
    uiTextSecondary: mixPct(base, 0.74, 'transparent'),
    uiTextTertiary,
    uiTextQuaternary: mixPct(base, 0.36, 'transparent'),
    /** thinking headers and tool rows: one grey for all of them, faded by SCAFFOLD_OPACITY */
    conversationScaffoldText: mixPct(base, 0.64, 'transparent'),
    conversationScaffoldMeta: mixPct(base, 0.44, 'transparent'),
    // desktop `.wordmark`: text-foreground/90 when dark, the accent when light
    uiWordmark: isDark ? mixPct(base, 0.9, 'transparent') : midground,

    uiStrokePrimary: fill(0.24, 0.1),
    uiStrokeSecondary: fill(0.16, 0.07),
    uiStrokeTertiary: fill(0.1, 0.05),
    uiStrokeQuaternary: fill(0.06, 0.03),
    /** `--stroke-nous`: the hairline paired with the floating-surface shadow on sheets and dialogs */
    strokeNous: mixPct(base, 0.03, 'transparent'),

    uiBgPrimary: fill(0.16, 0.1),
    uiBgSecondary: fill(0.11, 0.07),
    uiBgTertiary,
    uiBgQuaternary: fill(0.05, 0.04),
    uiBgQuinary: fill(0.03, 0.03),
    uiRowHoverBackground: fill(0.04, 0.03),
    uiRowActiveBackground,
    uiRowOpenBackground: mixPct(uiRowActiveBackground, 0.28, 'transparent'),
    uiControlActiveBackground: fill(0.08, 0.05),
    uiControlHoverBackground: fill(0.06, 0.04),

    uiAccent: midground,
    uiAccentSecondary: palette.primary,
    uiWarm: palette.primary,
    uiComposerRing: palette.composerRing ?? midground,
    uiSuccess: harmonize('#10b981', midground, 0.25),
    uiSelectionBackground: mixPct('#ffd24a', isDark ? 0.38 : 0.55, 'transparent'),
    uiInlineCodeBackground: isDark ? mixPct('#ffffff', 0.07, 'transparent') : mixPct('#141414', 0.05, 'transparent'),
    uiInlineCodeForeground: isDark ? mixPct('#ffffff', 0.88, 'transparent') : mixPct('#141414', 0.88, 'transparent'),

    uiRed: semantic.red,
    uiOrange: semantic.orange,
    uiYellow: semantic.yellow,
    uiGreen: semantic.green,
    uiCyan: semantic.cyan,
    uiBlue: semantic.blue,
    uiPurple: semantic.purple,
    uiDiffAddBorder: semantic.green,
    uiDiffAddBackground: mixPct(semantic.green, 0.12, 'transparent'),
    uiDiffAddForeground: isDark ? mixPct(semantic.green, 0.62, '#ffffff') : mixPct(semantic.green, 0.7, '#000000'),
    uiDiffRemoveBorder: semantic.red,
    uiDiffRemoveBackground: mixPct(semantic.red, 0.12, 'transparent'),
    uiDiffRemoveForeground: isDark ? mixPct(semantic.red, 0.62, '#ffffff') : mixPct(semantic.red, 0.7, '#000000'),

    dtCard: uiBgEditor,
    dtMuted: uiBgTertiary,
    dtMutedForeground: uiTextTertiary,
    dtPopover: mixPct(uiBgElevated, 0.96, 'transparent'),
    dtPrimary: palette.primary,
    dtPrimaryForeground: palette.primaryForeground,
    dtSecondary: palette.secondary,
    dtSecondaryForeground: palette.secondaryForeground,
    dtAccent: palette.accent,
    dtAccentForeground: palette.accentForeground,
    dtBorder: palette.border,
    dtInput: palette.input,
    dtRing: palette.ring,
    dtMidground: midground,
    dtMidgroundForeground: palette.midgroundForeground ?? readableInk(midground),
    // A loud fill of the brand colour: deepened until the light foreground clears AA
    dtPrimarySolid: ensureContrast(palette.primary, PRIMARY_SOLID_FOREGROUND, 4.5),
    dtPrimarySolidForeground: PRIMARY_SOLID_FOREGROUND,
    dtComposerRing: palette.composerRing ?? midground,
    // `oklch(from midground l 0 h)`, evaluated at resolve time
    dtScrollbarThumb: thumb ? oklchToHex({ l: thumb.l, c: 0, h: thumb.h }) : midground,
    dtDestructive: palette.destructive,
    dtDestructiveForeground: palette.destructiveForeground,
    dtSidebarBorder: palette.sidebarBorder ?? palette.border,
    dtUserBubble: uiChatBubbleBackground,
    dtUserBubbleBorder: palette.userBubbleBorder ?? palette.border,
    scrim: 'rgba(0, 0, 0, 0.22)',

    // --radius-scalar 0.2 × the styles.css ladder, 1:1 in dp (issue "Shell and loader prototype on device").
    radius: { xs: 0.4, sm: 1.6, md: 2, lg: 2.4, xl: 3.2, '2xl': 4.8, '3xl': 6.4, '4xl': 8, full: 9999 },

    // body 13px; the five conversation tokens scale with Chat Text Size and the platform font scale.
    type: {
      base: 13,
      text: 13 * effective,
      tool: 11 * effective,
      caption: 12 * effective,
      lineHeight: 18 * effective,
      captionLineHeight: 16 * effective,
    },
  };
}

export type Tokens = ReturnType<typeof resolve>;

const cache = new Map<string, Tokens>();
const CACHE_LIMIT = 48;

/** The resolved theme for a skin, mode, accent override and type scale; memoised per combination. */
export function resolveTheme(spec: ThemeSpec): Tokens {
  const key = `${spec.skin ?? DEFAULT_SKIN}|${spec.mode}|${spec.accent ?? ''}|${spec.chatTextScale ?? CHAT_TEXT_SCALE}|${spec.fontScale ?? 1}`;
  let tokens = cache.get(key);
  if (!tokens) {
    tokens = resolve(spec);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, tokens);
  }
  return tokens;
}

/** The default skin in one mode: what the pre-provider code paths resolved. */
export function resolveTokens(mode: Mode, chatTextScale = CHAT_TEXT_SCALE): Tokens {
  return resolveTheme({ mode, chatTextScale });
}

export const TokensContext = createContext<Tokens>(resolveTokens('dark'));

export const useTokens = () => useContext(TokensContext);
