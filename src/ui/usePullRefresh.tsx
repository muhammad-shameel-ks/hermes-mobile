/**
 * Branded pull-to-refresh: the platform pull gesture, the particle loader as its face.
 *
 * The gesture and its accessibility stay native (RefreshControl holds the inset while a refresh
 * runs). On iOS the native spinner is hidden and the rose-curve Loader grows with the finger above
 * the list, then spins at full size for the run. Android reports no overscroll distance to drive a
 * custom indicator with, so it keeps the platform spinner tinted to the skin's accent.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, RefreshControl, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { mixPct } from './color.ts';
import { Loader } from './loaders/Loader.tsx';
import { useTokens } from './tokens.ts';

/** the pull that arms the loader at full size; the native control fires around the same distance */
const ARM_DP = 76;
/** the indicator never grows past this while the finger is down */
const MAX_DP = 128;
/** the indicator's height while the refresh runs */
const REST_DP = 64;
const LOADER_DP = 30;

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

type Args = {
  refreshing: boolean;
  onRefresh: () => void;
  /** false while a reload would be meaningless (a turn streaming under the transcript) */
  enabled?: boolean;
};

type PullRefresh = {
  /** call inside the list's own onScroll, before or after it */
  track: (event: ScrollEvent) => void;
  /** the iOS loader header: first child of the list header, or of the scroll content */
  header: ReactElement | undefined;
  refreshControl: ReactElement<RefreshControlProps> | undefined;
};

export function usePullRefresh({ refreshing, onRefresh, enabled = true }: Args): PullRefresh {
  const t = useTokens();
  const pull = useSharedValue(0);
  const refreshingSV = useSharedValue(refreshing);
  // the loader mounts once a pull starts and unmounts when it settles, so nothing animates while idle
  const [active, setActive] = useState(false);

  useEffect(() => {
    refreshingSV.value = refreshing;
  }, [refreshing, refreshingSV]);
  useEffect(() => {
    if (refreshing) setActive(true);
    else if (pull.value <= 8) setActive(false);
  }, [refreshing, pull]);

  const track = useCallback(
    (event: ScrollEvent) => {
      const y = event.nativeEvent.contentOffset.y;
      pull.value = y < 0 ? -y : 0;
      if (y < -8) setActive(true);
      else if (y >= -8 && !refreshingSV.value) setActive(false);
    },
    [pull, refreshingSV],
  );

  // the finger drives the loader directly; every other transition eases, on the UI thread
  const bodyStyle = useAnimatedStyle(() => ({ height: withTiming(refreshingSV.value ? REST_DP : Math.min(pull.value, MAX_DP), { duration: 160 }) }));
  const loaderStyle = useAnimatedStyle(() => {
    const progress = refreshingSV.value ? 1 : Math.min(1, pull.value / ARM_DP);
    return { opacity: Math.min(1, progress * 1.5), transform: [{ scale: 0.5 + 0.5 * Math.min(1, progress) }] };
  });

  const header = useMemo(
    () =>
      Platform.OS === 'ios' && active ? (
        <Animated.View style={[styles.wrap, bodyStyle]}>
          <Animated.View style={loaderStyle}>
            <Loader size={LOADER_DP} color={mixPct(t.uiAccent, 0.7, 'transparent')} label="Refreshing" />
          </Animated.View>
        </Animated.View>
      ) : undefined,
    [active, bodyStyle, loaderStyle, t.uiAccent],
  );

  const refreshControl = useMemo(
    () =>
      Platform.OS === 'ios' ? (
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} enabled={enabled} tintColor="transparent" />
      ) : (
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} enabled={enabled} colors={[t.uiAccent]} progressBackgroundColor={t.uiBgSecondary} />
      ),
    [refreshing, onRefresh, enabled, t.uiAccent, t.uiBgSecondary],
  );

  return { track, header, refreshControl };
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
