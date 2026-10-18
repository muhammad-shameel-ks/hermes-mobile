/**
 * The two swipes that move the drawer: right across the chat opens it, left across the drawer or its
 * scrim closes it. Both drive the drawer's `progress` directly on the UI thread, so the panel tracks the
 * finger without a React render, and settle with the same timing the buttons use (`settleDrawer`).
 */

import { useMemo } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { Easing, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { dragProgress, settlesOpen } from './drawerGesture.ts';

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
          progress.value = dragProgress(0, event.translationX, width);
        })
        .onEnd((event) => {
          const open = settlesOpen(progress.value, event.velocityX);
          if (open) scheduleOnRN(onOpen);
          else settleDrawer(progress, false);
        }),
    [enabled, onOpen, progress, width],
  );
}

/** a left swipe on the open drawer drags it shut; `onClose` runs when it is released closed */
export function useDrawerCloseGesture(progress: SharedValue<number>, enabled: boolean, onClose: () => void) {
  const width = useDrawerWidth();
  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetX(-ACTIVE_X)
        .failOffsetX(ACTIVE_X)
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onUpdate((event) => {
          progress.value = dragProgress(1, event.translationX, width);
        })
        .onEnd((event) => {
          const open = settlesOpen(progress.value, event.velocityX);
          if (open) settleDrawer(progress, true);
          else scheduleOnRN(onClose);
        }),
    [enabled, onClose, progress, width],
  );
}
