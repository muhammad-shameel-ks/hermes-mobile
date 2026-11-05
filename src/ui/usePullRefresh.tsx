/**
 * Branded pull-to-refresh: the platform pull gesture, the particle loader as its face.
 *
 * The gesture and its accessibility stay native (RefreshControl holds the inset while a refresh
 * runs). On iOS the native spinner is hidden and the rose-curve Loader grows with the finger above
 * the list, then spins at full size for the run. Android reports no overscroll distance to drive a
 * custom indicator with, so it keeps the platform spinner tinted to the skin's accent.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, RefreshControl, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { mixPct } from './color.ts';
import { PULL_RELEASE_DP, pullArmed, pullSpinner } from './pullRefresh.ts';
import { Loader } from './loaders/Loader.tsx';
import { useTokens } from './tokens.ts';

/** the pull that arms the loader at full size; the native control fires around the same distance */
const ARM_DP = 76;
/** how long a finished refresh's inset may keep the next pull from arming, when no scroll event reports it */
const SETTLE_MS = 800;
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
  // the loader is only ever the reader's own pull: a refresh the app started (a drawer opening, a screen
  // mounting) must not insert its header under a scroll that is already moving
  const [active, setActive] = useState(false);
  // read inside `track` (a stable callback), kept in step with the state above
  const activeRef = useRef(false);
  const setArmed = useCallback((next: boolean) => {
    activeRef.current = next;
    setActive(next);
  }, []);
  const started = useRef(false);
  // a finished refresh's inset is still springing back: that is not a new pull
  const settling = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // a refresh that has ended is what starts the settle window; mounting with `refreshing` false is not one
  const wasRefreshing = useRef(refreshing);
  // the render that hears a refresh end must drop the native spinner, so `refreshing` is part of the term
  const spinning = pullSpinner(refreshing, active, started.current);

  const startRefresh = useCallback(() => {
    started.current = true;
    setArmed(true);
    onRefresh();
  }, [onRefresh, setArmed]);

  const refreshingSV = useSharedValue(spinning);
  useEffect(() => {
    refreshingSV.value = spinning;
  }, [spinning, refreshingSV]);
  useEffect(() => {
    const ended = wasRefreshing.current && !refreshing;
    wasRefreshing.current = refreshing;
    if (!ended) return;
    started.current = false;
    settling.current = true;
    setArmed(false);
    // the inset's spring-back is seen as scroll events and clears this; a list that sends none (already at
    // rest) must not leave the next pull dead
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settling.current = false;
    }, SETTLE_MS);
  }, [refreshing, setArmed]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const track = useCallback(
    (event: ScrollEvent) => {
      const y = event.nativeEvent.contentOffset.y;
      pull.value = y < 0 ? -y : 0;
      // the list is back at its top: the next downward pull is the reader's again
      if (y >= -PULL_RELEASE_DP) settling.current = false;
      const armed = pullArmed(y, activeRef.current, settling.current, started.current);
      if (armed !== activeRef.current) {
        activeRef.current = armed;
        setActive(armed);
      }
    },
    [pull],
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
        <RefreshControl refreshing={spinning} onRefresh={startRefresh} enabled={enabled} tintColor="transparent" />
      ) : (
        <RefreshControl refreshing={spinning} onRefresh={startRefresh} enabled={enabled} colors={[t.uiAccent]} progressBackgroundColor={t.uiBgSecondary} />
      ),
    [spinning, startRefresh, enabled, t.uiAccent, t.uiBgSecondary],
  );

  return { track, header, refreshControl };
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
