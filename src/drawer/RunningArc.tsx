/**
 * The travelling arc a working session row wears (apps/desktop/src/styles.css `.arc-border.arc-row`,
 * 2.23 s): a bright spike with a falling tail that crosses the row's border ring. The desktop masks a
 * moving linear gradient to the ring; the phone draws the ring as four hairline strips that clip the
 * same gradient and slide it, so nothing is masked and every frame is a transform on the UI thread.
 * Reduced motion paints nothing: the accent dot and the brighter title already say it.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { mixPct, transparentOf } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { ARC_WIDTH } from './rowGeometry.ts';

/** `--arc-duration` */
const ARC_MS = 2230;
/** the spike and its tail, as fractions of the sliding layer (the desktop's 25% / 31.25% stops over a 2x layer) */
const STOPS = [0.34, 0.5, 0.57, 0.74] as const;

export function RunningArc() {
  const t = useTokens();
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = 0;
    progress.value = withRepeat(withTiming(1, { duration: ARC_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress, reduced]);

  const { width, height } = size;
  // the sliding layer is twice the strip, spike at its centre: -W puts the spike on the left edge, 0 on the right
  const across = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));
  const acrossBack = useAnimatedStyle(() => ({ transform: [{ translateX: -progress.value * width }] }));
  const down = useAnimatedStyle(() => ({ transform: [{ translateY: (progress.value - 1) * height }] }));
  const up = useAnimatedStyle(() => ({ transform: [{ translateY: -progress.value * height }] }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w !== size.width || h !== size.height) setSize({ width: w, height: h });
  };

  if (reduced) return null;

  const spike = t.renderedMode === 'dark' ? t.dtForeground : t.dtMidground;
  const colors = [transparentOf(spike), spike, mixPct(spike, 0.45, 'transparent'), transparentOf(spike)] as const;
  const ready = width > 0 && height > 0;

  const strip = (side: 'top' | 'bottom' | 'left' | 'right', animated: object) => {
    const horizontal = side === 'top' || side === 'bottom';
    return (
      <View
        key={side}
        pointerEvents="none"
        style={[
          styles.strip,
          horizontal ? { left: 0, right: 0, height: ARC_WIDTH, [side]: 0 } : { top: 0, bottom: 0, width: ARC_WIDTH, [side]: 0 },
        ]}
      >
        <Animated.View style={[horizontal ? { width: width * 2, height: ARC_WIDTH } : { width: ARC_WIDTH, height: height * 2 }, animated]}>
          <LinearGradient
            colors={colors}
            locations={STOPS}
            start={{ x: 0, y: 0 }}
            end={horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
    );
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout} importantForAccessibility="no-hide-descendants">
      {ready ? [strip('top', across), strip('right', down), strip('bottom', acrossBack), strip('left', up)] : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', overflow: 'hidden' },
});
