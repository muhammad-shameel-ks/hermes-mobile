/**
 * The desktop's small transcript motions (research loadermotion: message enter,
 * disclosure caret), ported to Reanimated. Every timing here is the desktop's.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Codicon } from './Codicon.tsx';

/** desktop lib/use-enter-animation: 180 ms, translateY(0.375rem) -> 0, transform only */
const ENTER_OFFSET = 6;
const ENTER_TIMING = { duration: 180, easing: Easing.bezier(0.16, 1, 0.3, 1) };

// Once per key: a row the list virtualised away and remounts must not replay.
const played = new Set<string>();
const playedOrder: string[] = [];
const MAX_TRACKED_KEYS = 2048;

function remember(key: string) {
  if (played.has(key)) return;
  played.add(key);
  playedOrder.push(key);
  if (playedOrder.length > MAX_TRACKED_KEYS) played.delete(playedOrder.shift()!);
}

/** Slides its children up into place once, when `enabled` holds at mount. */
export function EnterView({
  enabled,
  animationKey,
  style,
  children,
}: {
  enabled: boolean;
  animationKey: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [animate] = useState(() => enabled && !reduced && !played.has(animationKey));
  const offset = useSharedValue(animate ? ENTER_OFFSET : 0);

  useEffect(() => {
    if (!animate) return;
    remember(animationKey);
    offset.value = withTiming(0, ENTER_TIMING);
  }, [animate, animationKey, offset]);

  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  if (!animate) return style ? <Animated.View style={style}>{children}</Animated.View> : <>{children}</>;
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** desktop components/ui/disclosure-caret: chevron-right, rotated 90° when open over 150 ms */
export function DisclosureCaret({ open, size = 12, color, style }: { open: boolean; size?: number; color: string; style?: StyleProp<TextStyle> }) {
  const rotation = useSharedValue(open ? 90 : 0);

  useEffect(() => {
    rotation.value = withTiming(open ? 90 : 0, { duration: 150 });
  }, [open, rotation]);

  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={[{ width: size, height: size }, animated]}>
      <Codicon name="chevron-right" size={size} color={color} style={style} />
    </Animated.View>
  );
}
