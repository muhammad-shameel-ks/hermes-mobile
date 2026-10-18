/**
 * Pushed full-screen overlays (issue "App shell and navigation on a phone"):
 * Settings, Files, Review, the preview viewer and other routes push onto one
 * stack above the chat root; hardware back pops the top entry (back rule 3).
 * Sheets stay for pickers and confirms only.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Codicon } from '../ui/Codicon.tsx';
import { useTokens } from '../ui/tokens.ts';

/** Renders one pushed route; `close` pops this entry. */
export type OverlayRender = (close: () => void) => ReactNode;

type Entry = { id: number; key: string; render: OverlayRender };

export type OverlayApi = {
  /** Push a route. A route already on the stack under the same key is brought to the top instead of duplicated. */
  push: (key: string, render: OverlayRender) => void;
  /** Pop the top route. */
  pop: () => void;
  /** Pop every route back to the chat root. */
  clear: () => void;
  depth: number;
};

const OverlayContext = createContext<OverlayApi | null>(null);

export function useOverlay(): OverlayApi {
  const api = useContext(OverlayContext);
  if (!api) throw new Error('useOverlay must be used inside <OverlayProvider>');
  return api;
}

/** `above` draws over every pushed route: what has to reach the reader wherever they are */
export function OverlayProvider({ children, above }: { children: ReactNode; above?: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]);
  const nextId = useRef(1);

  const push = useCallback((key: string, render: OverlayRender) => {
    setStack((prev) => [...prev.filter((e) => e.key !== key), { id: nextId.current++, key, render }]);
  }, []);
  const pop = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);
  const clear = useCallback(() => setStack([]), []);

  useEffect(() => {
    if (stack.length === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const api = useMemo(() => ({ push, pop, clear, depth: stack.length }), [push, pop, clear, stack.length]);

  return (
    <OverlayContext.Provider value={api}>
      {children}
      {stack.map((entry) => (
        <Animated.View key={entry.id} style={StyleSheet.absoluteFill} entering={SlideInRight.duration(220)} exiting={SlideOutRight.duration(180)}>
          {entry.render(() => setStack((prev) => prev.filter((e) => e.id !== entry.id)))}
        </Animated.View>
      ))}
      {above}
    </OverlayContext.Provider>
  );
}

/** Standard chrome for a pushed route: back chevron, title, optional trailing slot, then content. */
export function OverlayScreen({ title, onBack, trailing, children }: { title: string; onBack: () => void; trailing?: ReactNode; children: ReactNode }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: t.uiChatSurfaceBackground, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.uiStrokeSecondary }]}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
          <Codicon name="chevron-left" size={18} color={t.uiTextPrimary} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: t.uiTextPrimary }]}>
          {title}
        </Text>
        <View style={styles.trailing}>{trailing}</View>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 15, fontWeight: '600' },
  trailing: { minWidth: 40, alignItems: 'flex-end', justifyContent: 'center' },
  body: { flex: 1 },
});
