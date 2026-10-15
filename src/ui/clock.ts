/**
 * The shared clock for decorative loops. One repeating 0..1 shared value per distinct
 * spec (loops.ts), however many components read it: N shimmering labels, N spinners and
 * N running arcs cost one timeline each, not N, and stay in phase. Consumers derive their
 * transform in their own `useAnimatedStyle` from `loop.value` and must touch only
 * `transform` / `opacity`, which Reanimated applies synchronously on the UI thread; layout
 * props and SVG geometry take the shadow-tree commit path, which contends with React's own
 * commits while a reply streams.
 *
 * Timelines stop with the app in the background and while a caller holds them (`holdLoops`).
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { cancelAnimation, Easing, makeMutable, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

import { createLoopRegistry, type LoopSpec } from './loops.ts';

export type { LoopSpec };

const registry = createLoopRegistry<SharedValue<number>>({
  create: () => makeMutable(0),
  start: (value, spec) => {
    cancelAnimation(value);
    value.value = 0;
    value.value = withRepeat(
      withTiming(1, { duration: spec.durationMs, easing: spec.steps ? Easing.steps(spec.steps, true) : Easing.linear }),
      -1,
      false,
    );
  },
  stop: (value) => cancelAnimation(value),
});

// only an explicit background pauses: an unknown or inactive state is still on screen
const foreground = () => AppState.currentState !== 'background';
registry.setForeground(foreground());
AppState.addEventListener('change', () => registry.setForeground(foreground()));

/**
 * The 0..1 timeline for `spec`, running while this component is mounted and `enabled`.
 * Every component asking for the same spec gets the same value.
 */
export function useLoop(spec: LoopSpec, enabled = true): SharedValue<number> {
  const { durationMs, steps } = spec;
  const value = useMemo(() => registry.value({ durationMs, steps }), [durationMs, steps]);
  useEffect(() => (enabled ? registry.acquire({ durationMs, steps }) : undefined), [durationMs, steps, enabled]);
  return value;
}

/**
 * Freeze every decorative loop until the returned function is called, for a moment the
 * motion would only compete with something the reader is driving (a drawer drag).
 */
export function holdLoops(): () => void {
  return registry.hold();
}

const subscribeAppState = (listener: () => void) => {
  const sub = AppState.addEventListener('change', listener);
  return () => sub.remove();
};

/** whether the app is in the foreground, for animation drivers that are not `useLoop` consumers */
export function useAppForeground(): boolean {
  return useSyncExternalStore(subscribeAppState, foreground);
}
