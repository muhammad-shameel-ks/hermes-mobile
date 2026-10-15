/**
 * The stored appearance choices and their validation: skin, mode preference,
 * accent override, Chat Text Size and the translucency book. Pure, so the
 * provider's persistence and the tests share one normaliser. Translucency
 * survives as data only (issue "Theme and typography emulation on React
 * Native"): nothing on the phone paints it, but the schema round-trips.
 */

import { normalizeBook, type TranslucencyBook } from '../../vendor/hermes-shared/src/translucency.ts';
import { normalizeHex } from './color.ts';
import { DEFAULT_SKIN, normalizeModePreference, normalizeSkin, type ModePreference, type SkinName } from './skins.ts';

/** desktop store/chat-text-scale: the presets, as percentages */
export const CHAT_TEXT_SCALE_PRESETS = [90, 100, 110, 125, 150, 175] as const;
export type ChatTextScale = (typeof CHAT_TEXT_SCALE_PRESETS)[number];
export const DEFAULT_CHAT_TEXT_SCALE: ChatTextScale = 110;

export function normalizeChatTextScale(value: unknown): ChatTextScale {
  return CHAT_TEXT_SCALE_PRESETS.find((preset) => preset === Number(value)) ?? DEFAULT_CHAT_TEXT_SCALE;
}

export type AppearancePrefs = {
  skin: SkinName;
  mode: ModePreference;
  /** accent override as `#rrggbb`, or null for the skin's own */
  accent: string | null;
  chatTextScale: ChatTextScale;
  translucency: TranslucencyBook;
};

// Glass is not offered on the phone, so the book normalises as if it were: stored values keep the
// desktop's schema and a settings sync can read them back unchanged.
const GLASS_SUPPORTED = false;

export const DEFAULT_PREFS: AppearancePrefs = {
  skin: DEFAULT_SKIN,
  mode: 'system',
  accent: null,
  chatTextScale: DEFAULT_CHAT_TEXT_SCALE,
  translucency: normalizeBook(null, GLASS_SUPPORTED),
};

/** Parse a stored JSON payload into safe prefs; anything unreadable falls back per key. */
export function normalizePrefs(payload: unknown): AppearancePrefs {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return {
    skin: normalizeSkin(record.skin),
    mode: normalizeModePreference(record.mode),
    accent: normalizeHex(typeof record.accent === 'string' ? record.accent : null),
    chatTextScale: normalizeChatTextScale(record.chatTextScale),
    translucency: normalizeBook(record.translucency, GLASS_SUPPORTED),
  };
}

export function parsePrefs(text: string | null | undefined): AppearancePrefs {
  if (!text) return DEFAULT_PREFS;
  try {
    return normalizePrefs(JSON.parse(text));
  } catch {
    return DEFAULT_PREFS;
  }
}
