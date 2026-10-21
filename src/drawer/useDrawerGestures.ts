/**
 * The two swipes on the drawer: right across the chat drags it open, and across the open drawer a
 * swipe moves between its tabs instead of closing it. The open drag drives the drawer's `progress`
 * directly on the UI thread, so the panel tracks the finger without a React render, and settles with
 * the same timing the buttons use (`settleDrawer`). The tab swipe crosses to JS once, on release.
 */

import { useMemo } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { Easing, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { tick } from '../ui/haptics.ts';
import { dragProgress, settlesOpen, tabStep } from './drawerGesture.ts';

export const DRAWER_DURATION = 220;
export const drawerEasing = Easing.out(Easing.cubic);

/** horizontal travel before a swipe counts, and the vertical drift that hands the touch to a list */
const ACTIVE_X = 16;
const FAIL_Y = 14;

export function useDrawerWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(Math.round(width * 0.86), 360);
}

export function settleDrawer(progress: SharedValue<number>, open: boolean) {
  'worklet';
  progress.value = withTiming(open ? 1 : 0, { duration: DRAWER_DURATION, easing: drawerEasing });
}

const dismissKeyboard = () => Keyboard.dismiss();

/** a right swipe on the chat drags the drawer out; `onOpen` runs when it is released open */
export function useDrawerOpenGesture(progress: SharedValue<number>, enabled: boolean, onOpen: () => void) {
  const width = useDrawerWidth();
  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetX(ACTIVE_X)
        .failOffsetX(-ACTIVE_X)
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onStart(() => {
          scheduleOnRN(dismissKeyboard);
        })
        .onUpdate((event) => {
          progress.value = dragProgress(event.translationX, width);
        })
        .onEnd((event) => {
          const open = settlesOpen(progress.value, event.velocityX);
          if (open) scheduleOnRN(onOpen);
          else settleDrawer(progress, false);
        }),
    [enabled, onOpen, progress, width],
  );
}

/**
 * A horizontal swipe across the open drawer: left to the next tab, right to the one before, holding at
 * the ends. It never closes the drawer; the scrim, back and picking a row do.
 */
export function useDrawerTabGesture<T extends string>(enabled: boolean, tabs: ReadonlyArray<{ value: T }>, tab: T, onTab: (tab: T) => void) {
  return useMemo(() => {
    const land = (translationX: number, velocityX: number) => {
      const next = tabs[tabs.findIndex((entry) => entry.value === tab) + tabStep(translationX, velocityX)]?.value;
      if (next === undefined || next === tab) return;
      tick();
      onTab(next);
    };
    return Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .activeOffsetX([-ACTIVE_X, ACTIVE_X])
      .failOffsetY([-FAIL_Y, FAIL_Y])
      .onEnd((event, success) => {
        if (success) scheduleOnRN(land, event.translationX, event.velocityX);
      });
  }, [enabled, tabs, tab, onTab]);
}
