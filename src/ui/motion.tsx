/**
 * The desktop's small transcript motions (research loadermotion: message enter,
 * disclosure caret), ported to Reanimated. Every timing here is the desktop's.
 */

import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

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

/** a view leaving under a new one (an empty state handing over to the transcript): the Notice's 180 ms */
const EXIT_DURATION = 180;

type RevealProps = {
  style?: StyleProp<ViewStyle>;
  /** rise by ENTER_OFFSET as it fades in, like a message enter; a transcript-sized view only fades */
  rise?: boolean;
  /** fade out over EXIT_DURATION when it unmounts, instead of vanishing */
  exit?: boolean;
  children: ReactNode;
};

/**
 * Fades its children in when it mounts, over ENTER_TIMING (rising ENTER_OFFSET with `rise`). Opacity and
 * transform only. As in EnterView the plain-versus-animated choice is made at mount: with reduced motion
 * it is a plain View with no shared value, animated style or layout animation.
 */
export function Reveal({ style, rise = false, exit = false, children }: RevealProps) {
  const reduced = useReducedMotion();
  const [animate] = useState(() => !reduced);
  if (animate) return <AnimatedReveal style={style} rise={rise} exit={exit}>{children}</AnimatedReveal>;
  return <View style={style}>{children}</View>;
}

const EXITING = FadeOut.duration(EXIT_DURATION);

function AnimatedReveal({ style, rise, exit, children }: RevealProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, ENTER_TIMING);
  }, [progress]);

  const animated = useAnimatedStyle(() =>
    rise ? { opacity: progress.value, transform: [{ translateY: (1 - progress.value) * ENTER_OFFSET }] } : { opacity: progress.value },
  );
  return (
    <Animated.View style={[style, animated]} exiting={exit ? EXITING : undefined}>
      {children}
    </Animated.View>
  );
}

type SwitchFadeProps = {
  /** advances when the content became another one's; the view fades back in on each advance, never on mount */
  epoch: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * One persistent container whose content is swapped under it: each time `epoch` advances its opacity
 * restarts from 0 and eases to 1 over ENTER_TIMING, on the UI thread. It never remounts its children
 * (a list keeps its scroll state and refs) and an unchanged epoch costs nothing, so a stream's re-renders
 * and a reconnect do not replay it.
 */
export function SwitchFade({ epoch, style, children }: SwitchFadeProps) {
  const reduced = useReducedMotion();
  const [animate] = useState(() => !reduced);
  if (animate) return <AnimatedSwitch epoch={epoch} style={style}>{children}</AnimatedSwitch>;
  return <View style={style}>{children}</View>;
}

function AnimatedSwitch({ epoch, style, children }: SwitchFadeProps) {
  const opacity = useSharedValue(1);
  const shown = useRef(epoch);

  // a layout effect, not a passive one: the restart is queued in the commit that brings the new content, not a frame later
  useLayoutEffect(() => {
    if (shown.current === epoch) return;
    shown.current = epoch;
    opacity.value = 0;
    opacity.value = withTiming(1, ENTER_TIMING);
  }, [epoch, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
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
