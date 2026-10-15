/**
 * The desktop's small transcript motions (research loadermotion: message enter,
 * disclosure caret), ported to Reanimated. Every timing here is the desktop's.
 */

import { memo, useEffect, useState, type ReactNode } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
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

type EnterProps = {
  enabled: boolean;
  animationKey: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Slides its children up into place once, when `enabled` holds at mount. The choice is made at
 * mount and never changes, so a row that does not animate (history, a remount, reduced motion)
 * never allocates a shared value or an animated style: `animate` is false for nearly every row.
 */
export function EnterView({ enabled, animationKey, style, children }: EnterProps) {
  const reduced = useReducedMotion();
  const [animate] = useState(() => enabled && !reduced && !played.has(animationKey));
  if (animate) return <AnimatedEnter animationKey={animationKey} style={style}>{children}</AnimatedEnter>;
  return style ? <View style={style}>{children}</View> : <>{children}</>;
}

function AnimatedEnter({ animationKey, style, children }: Omit<EnterProps, 'enabled'>) {
  const offset = useSharedValue(ENTER_OFFSET);

  useEffect(() => {
    remember(animationKey);
    offset.value = withTiming(0, ENTER_TIMING);
  }, [animationKey, offset]);

  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

const CARET_OPEN: ViewStyle = { transform: [{ rotate: '90deg' }] };

type CaretProps = { open: boolean; size?: number; color: string; style?: StyleProp<TextStyle> };

/**
 * desktop components/ui/disclosure-caret: chevron-right, rotated 90° when open over 150 ms. A caret
 * at rest is a plain rotated view; the shared value and animated style exist only on a caret whose
 * row has been toggled, so opening a run of N rows mounts N cheap carets, not N animations.
 */
export const DisclosureCaret = memo(function DisclosureCaret({ open, size = 12, color, style }: CaretProps) {
  const [initial] = useState(open);
  const [toggled, setToggled] = useState(false);
  if (!toggled && open !== initial) setToggled(true);
  if (toggled) return <AnimatedCaret open={open} initial={initial} size={size} color={color} style={style} />;
  return (
    <View style={[{ width: size, height: size }, open ? CARET_OPEN : null]}>
      <Codicon name="chevron-right" size={size} color={color} style={style} />
    </View>
  );
});

function AnimatedCaret({ open, initial, size = 12, color, style }: CaretProps & { initial: boolean }) {
  const rotation = useSharedValue(initial ? 90 : 0);

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
