/**
 * The assistant card's root (`HermesAssistant`): what the phone shows when Hermes is its digital
 * assistant and the reader long-presses power or swipes from a corner. It runs in the app's own JS
 * runtime (modules/hermes-assistant's AssistantActivity), so it opens on the app's signed-in stack
 * when one is running and restores the saved connection the way the app does when not.
 *
 * The window is transparent: the app the card was summoned over stays on screen behind a light scrim.
 * Tapping outside, back, a drag down or the close button play the exit and close the window.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as NativeAppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { assistant } from '../../modules/hermes-assistant/index.ts';
import type { AppState } from '../app/boot-state.ts';
import type { Hosted } from '../app/controllerHost.ts';
import { restore, runningStack, signedInStack } from '../app/signedIn.ts';
import type { ChatController } from '../chat/controller.ts';
import { APP_FONTS } from '../ui/fonts.ts';
import { ThemeProvider } from '../ui/ThemeProvider.tsx';
import { ShimmerText } from '../ui/ShimmerText.tsx';
import { useTokens } from '../ui/tokens.ts';
import { CardFrame, PresenceContext, ReadyCard } from './AssistantCard.tsx';

type Boot =
  | { kind: 'starting' }
  | { kind: 'ready'; hosted: Hosted<ChatController> }
  | { kind: 'blocked'; title: string; detail: string | null; retry: boolean };

function blockedFor(state: Exclude<AppState, { kind: 'signed-in' } | { kind: 'starting' }>): Boot {
  switch (state.kind) {
    case 'connect':
      return { kind: 'blocked', title: 'Hermes is not connected yet', detail: 'Open Hermes and connect it to your gateway.', retry: false };
    case 'signed-out':
      return { kind: 'blocked', title: 'Sign in to Hermes', detail: 'Open Hermes to sign in to your gateway.', retry: false };
    case 'reauth':
      return { kind: 'blocked', title: 'Sign in to Hermes again', detail: state.reason, retry: false };
    case 'unreachable':
      return { kind: 'blocked', title: state.headline, detail: state.detail, retry: true };
  }
}

/** the running stack at once, else the app's restore; holds the stack while the card is up */
function useBoot(): [Boot, () => void] {
  const [boot, setBoot] = useState<Boot>(() => {
    const running = runningStack();
    return running ? { kind: 'ready', hosted: running } : { kind: 'starting' };
  });
  const live = useRef(true);

  const attempt = useCallback(() => {
    setBoot({ kind: 'starting' });
    void restore().then((state) => {
      if (!live.current) return;
      if (state.kind === 'signed-in') setBoot({ kind: 'ready', hosted: signedInStack(state.connection, state.credentials) });
      else if (state.kind !== 'starting') setBoot(blockedFor(state));
    });
  }, []);

  useEffect(() => {
    live.current = true;
    if (boot.kind === 'starting') attempt();
    return () => {
      live.current = false;
    };
    // the first boot only; a retry calls attempt itself
  }, []);

  const hosted = boot.kind === 'ready' ? boot.hosted : null;
  useEffect(() => {
    if (!hosted) return;
    const release = hosted.hold((reason) => setBoot({ kind: 'blocked', title: 'Sign in to Hermes again', detail: reason, retry: false }));
    hosted.value.start();
    return release;
  }, [hosted]);

  return [boot, attempt];
}

function AssistantScreen() {
  const t = useTokens();
  const [boot, retry] = useBoot();
  const reduced = useReducedMotion();
  const shown = useSharedValue(0);
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const closing = useRef(false);

  const rise = useCallback(() => {
    if (closing.current) return;
    if (reduced) {
      shown.value = 1;
      setEntered(true);
      return;
    }
    shown.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) scheduleOnRN(setEntered, true);
    });
  }, [shown, reduced]);

  useEffect(() => {
    rise();
    // a system dialog over the card (an unlock, the mic permission) can cut the rise short: finish it on return
    const sub = NativeAppState.addEventListener('change', (state) => {
      if (state === 'active') rise();
    });
    return () => sub.remove();
  }, [rise]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setLeaving(true);
    const dismiss = () => assistant?.dismiss();
    if (reduced) {
      dismiss();
      return;
    }
    shown.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) scheduleOnRN(dismiss);
    });
  }, [shown, reduced]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const scrim = useAnimatedStyle(() => ({ opacity: shown.value }));
  const openApp = useCallback(() => assistant?.openApp(), []);
  const settled = entered && !leaving;
  const presence = useMemo(() => ({ shown, entered, settled }), [shown, entered, settled]);

  return (
    <PresenceContext.Provider value={presence}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, settled ? null : scrim]}>
        <LinearGradient style={StyleSheet.absoluteFill} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.42)']} locations={[0, 0.45, 1]} />
      </Animated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close Hermes" />
      {boot.kind === 'ready' ? (
        <ReadyCard hosted={boot.hosted} onClose={close} />
      ) : (
        <CardFrame phase="idle" onClose={close} onOpenApp={openApp}>
          {boot.kind === 'starting' ? (
            <View style={styles.body}>
              <ShimmerText fontSize={t.type.text} style={{ fontSize: t.type.text, color: t.uiTextSecondary }}>
                Connecting to Hermes…
              </ShimmerText>
            </View>
          ) : (
            <View style={styles.body}>
              <Text style={[styles.title, { color: t.uiTextPrimary }]}>{boot.title}</Text>
              {boot.detail ? <Text style={[styles.detail, { color: t.uiTextSecondary }]}>{boot.detail}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={boot.retry ? retry : openApp}
                style={({ pressed }) => [styles.action, { backgroundColor: t.dtForeground, borderRadius: t.radius.lg, opacity: pressed ? 0.9 : 1 }]}
              >
                <Text style={[styles.actionText, { color: t.dtBackground }]}>{boot.retry ? 'Try again' : 'Open Hermes'}</Text>
              </Pressable>
            </View>
          )}
        </CardFrame>
      )}
    </PresenceContext.Provider>
  );
}

export default function AssistantApp() {
  useFonts(APP_FONTS);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider paintsWindow={false}>
          <KeyboardProvider>
            <AssistantScreen />
          </KeyboardProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  body: { gap: 8, paddingHorizontal: 2, paddingBottom: 4, alignItems: 'flex-start' },
  title: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 14, lineHeight: 20 },
  action: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 9 },
  actionText: { fontSize: 14, fontWeight: '600' },
});
