/**
 * A screen root that pads its bottom by the soft keyboard's live height, frame by
 * frame on the UI thread. It replaces `KeyboardAvoidingView` for screens that reach
 * the window's bottom edge: the app draws edge to edge, so the keyboard's inset
 * (navigation bar included) is exactly the padding that lifts the bottom of the
 * screen onto the keyboard's top. `KeyboardAvoidingView` instead derives it from a
 * measured window position, and a stale or failed measurement (status bar padding,
 * a transition, the async native read losing a race) left the composer partly
 * under the keyboard.
 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

export function KeyboardPaddedView({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  // height is the keyboard's translateY: 0 when closed, minus its full inset when open
  const { height } = useReanimatedKeyboardAnimation();
  const padded = useAnimatedStyle(() => ({ paddingBottom: Math.max(-height.value, 0) }));
  return <Reanimated.View style={[style, padded]}>{children}</Reanimated.View>;
}
