/**
 * One line of text with the desktop's `shimmer` sweep (see shimmer.ts): a soft
 * highlight band crosses the glyphs left to right, pauses, and goes again.
 * Under reduced motion the text is still.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { shimmerRings, shimmerTiming, type ShimmerRing } from './shimmer.ts';

type Props = {
  children: string;
  style: StyleProp<TextStyle>;
  fontSize: number;
  /** the colour the band's centre turns the text toward, and how far */
  highlight: { color: string; peak: number };
};

export function ShimmerText({ children, style, fontSize, highlight }: Props) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const timing = useMemo(() => shimmerTiming(fontSize), [fontSize]);
  const rings = useMemo(() => shimmerRings(timing.spread, highlight.peak), [timing.spread, highlight.peak]);
  const centre = useSharedValue(-timing.spread);

  useEffect(() => {
    if (reduced || width === 0) return;
    const from = -timing.spread / 2;
    const to = width + timing.spread / 2;
    centre.value = from;
    centre.value = withRepeat(
      withSequence(withTiming(to, { duration: timing.sweepMs, easing: Easing.linear }), withDelay(timing.delayMs, withTiming(from, { duration: 0 }))),
      -1,
    );
    return () => cancelAnimation(centre);
  }, [reduced, width, timing, centre]);

  return (
    <View style={styles.root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text numberOfLines={1} style={style}>
        {children}
      </Text>
      {!reduced && width > 0
        ? rings.map((ring, index) =>
            ring.opacity > 0 ? (
              <Window key={index} ring={ring} centre={centre} width={width}>
                <Text numberOfLines={1} style={[style, { color: highlight.color, width }]}>
                  {children}
                </Text>
              </Window>
            ) : null,
          )
        : null}
    </View>
  );
}

/** a clipped window riding the band's centre, its copy of the text counter-shifted to stay on the glyphs below */
function Window({ ring, centre, width, children }: { ring: ShimmerRing; centre: SharedValue<number>; width: number; children: ReactNode }) {
  const frame = useAnimatedStyle(() => ({ transform: [{ translateX: centre.value - ring.halfWidth }] }));
  const copy = useAnimatedStyle(() => ({ transform: [{ translateX: ring.halfWidth - centre.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.window, { width: ring.halfWidth * 2, opacity: ring.opacity }, frame]}>
      <Animated.View style={[styles.copy, { width }, copy]}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flexShrink: 1, minWidth: 0 },
  window: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  copy: { position: 'absolute', top: 0, left: 0 },
});
