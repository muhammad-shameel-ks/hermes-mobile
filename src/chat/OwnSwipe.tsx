/**
 * Enrols a scroll view the app does not render itself in the gesture system: the ones react-native-marked
 * renders (a table, a plain code block) and the transcript's assistant-ui list. Left out, the shell's
 * drawer swipe takes the touch over 16 dp in and opens the drawer mid-scroll. The child's root view must
 * be the scroll view. Scroll views the app renders itself import gesture-handler's `ScrollView`, which
 * does the same.
 */

import { useMemo, type ReactNode } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export function OwnSwipe({ children }: { children: ReactNode }) {
  // gesture-handler's ScrollView config: once scrolling, nothing else may take the touch
  const gesture = useMemo(() => Gesture.Native().disallowInterruption(true).shouldCancelWhenOutside(false), []);
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}
