/**
 * Owns the stored appearance choices and publishes the resolved theme.
 *
 * Skin, mode preference, accent override and Chat Text Size persist as one JSON
 * file in the document directory, read synchronously so the first frame already
 * paints the chosen skin. `useTokens()` keeps returning the concrete token
 * values; `useAppearance()` adds the choices and their setters for the
 * Appearance section.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme, useWindowDimensions } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';

import type { TranslucencyBook } from '../../vendor/hermes-shared/src/translucency.ts';
import { DEFAULT_PREFS, normalizeChatTextScale, parsePrefs, type AppearancePrefs, type ChatTextScale } from './appearance.ts';
import { normalizeHex } from './color.ts';
import { normalizeSkin, resolveMode, type Mode, type ModePreference, type SkinName } from './skins.ts';
import { resolveTheme, TokensContext, useTokens } from './tokens.ts';

export type AppearanceApi = AppearancePrefs & {
  /** the light/dark switch after `system` resolves */
  resolvedMode: Mode;
  /** the mode actually painted, derived from the background's luminance */
  renderedMode: Mode;
  /** choosing a skin clears the accent override, as picking another skin does on the desktop */
  setSkin: (skin: SkinName) => void;
  setMode: (mode: ModePreference) => void;
  setAccent: (accent: string | null) => void;
  setChatTextScale: (percent: number) => void;
  setTranslucency: (book: TranslucencyBook) => void;
};

const noop = () => {};

const AppearanceContext = createContext<AppearanceApi>({
  ...DEFAULT_PREFS,
  resolvedMode: 'dark',
  renderedMode: 'dark',
  setSkin: noop,
  setMode: noop,
  setAccent: noop,
  setChatTextScale: noop,
  setTranslucency: noop,
});

export const useAppearance = () => useContext(AppearanceContext);

const prefsFile = () => new File(Paths.document, 'appearance.json');

function loadPrefs(): AppearancePrefs {
  try {
    const file = prefsFile();
    return file.exists ? parsePrefs(file.textSync()) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: AppearancePrefs): void {
  try {
    const file = prefsFile();
    file.create({ overwrite: true });
    file.write(JSON.stringify(prefs));
  } catch {
    // appearance is a convenience: a failed write keeps the choice for this run
  }
}

/** `paintsWindow={false}` for a root drawn over another app (the assistant card): its window stays transparent */
export function ThemeProvider({ children, paintsWindow = true }: { children: ReactNode; paintsWindow?: boolean }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const systemDark = useColorScheme() === 'dark';
  const { fontScale } = useWindowDimensions();
  const resolvedMode = resolveMode(prefs.mode, systemDark);

  const tokens = useMemo(
    () => resolveTheme({ skin: prefs.skin, mode: resolvedMode, accent: prefs.accent, chatTextScale: prefs.chatTextScale / 100, fontScale }),
    [prefs.skin, resolvedMode, prefs.accent, prefs.chatTextScale, fontScale],
  );

  const written = useRef(prefs);
  useEffect(() => {
    if (written.current === prefs) return;
    written.current = prefs;
    savePrefs(prefs);
  }, [prefs]);

  // an explicit light or dark pick pins the native chrome (dialogs, keyboard); `system` follows the OS
  useEffect(() => {
    Appearance.setColorScheme(prefs.mode === 'system' ? 'unspecified' : prefs.mode);
  }, [prefs.mode]);

  useEffect(() => {
    if (paintsWindow) void SystemUI.setBackgroundColorAsync(tokens.uiBgChrome).catch(() => {});
  }, [tokens.uiBgChrome, paintsWindow]);

  const update = useCallback((patch: Partial<AppearancePrefs>) => setPrefs((prev) => ({ ...prev, ...patch })), []);

  const api = useMemo<AppearanceApi>(
    () => ({
      ...prefs,
      resolvedMode,
      renderedMode: tokens.renderedMode,
      setSkin: (skin) => update({ skin: normalizeSkin(skin), accent: null }),
      setMode: (mode) => update({ mode }),
      setAccent: (accent) => update({ accent: accent === null ? null : normalizeHex(accent) }),
      setChatTextScale: (percent) => update({ chatTextScale: normalizeChatTextScale(percent) as ChatTextScale }),
      setTranslucency: (translucency) => update({ translucency }),
    }),
    [prefs, resolvedMode, tokens.renderedMode, update],
  );

  return (
    <AppearanceContext.Provider value={api}>
      <TokensContext.Provider value={tokens}>{children}</TokensContext.Provider>
    </AppearanceContext.Provider>
  );
}

/** The system bars' icon style follows the rendered mode, not the preference. */
export function ThemedStatusBar() {
  const { renderedMode } = useAppearance();
  return <StatusBar style={renderedMode === 'dark' ? 'light' : 'dark'} />;
}

/** The app root: fills the screen with the chrome background, so no frame ever paints white. */
export function ThemedSafeAreaView({ style, ...props }: SafeAreaViewProps) {
  const t = useTokens();
  return <SafeAreaView {...props} style={[{ flex: 1, backgroundColor: t.uiBgChrome }, style]} />;
}
