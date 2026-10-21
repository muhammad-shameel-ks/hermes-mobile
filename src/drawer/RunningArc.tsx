/**
 * The travelling arc a working session row wears (apps/desktop/src/styles.css `.arc-border.arc-row`,
 * 2.23 s): a bright spike with a falling tail that crosses the row's border ring. The desktop masks a
 * moving repeating gradient to the ring; the phone draws the ring as four hairline strips that clip the
 * same gradient and slide it, so nothing is masked and every frame is a transform on the UI thread.
 *
 * The ring is one loop: each side carries one spike per cycle, laid out in travel order (clockwise),
 * so a spike leaving a corner is the next side's spike arriving. Each strip's layer holds two periods
 * of the band and slides exactly one period per cycle, so the frame at 1 equals the frame at 0 and the
 * repeat has no seam. Bottom and left are top and right mirrored, so one style drives each axis.
 * The slide reads the app's shared loop (ui/clock.ts), so every working row's arc is in step on one timeline.
 * Reduced motion paints nothing: the accent dot and the brighter title already say it.
 * `color` and `durationMs` let the kanban card paint its lane's tone at the desktop card arc's pace
 * (`kanban.css`: 2.2 s, a 6 s amber crawl once the heartbeat is gone).
 */

import { memo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

import { useLoop } from '../ui/clock.ts';
import { mixPct, transparentOf } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { ARC_WIDTH } from './rowGeometry.ts';

/** `--arc-duration` */
const ARC_MS = 2230;
/**
 * One period of the band, as fractions of a side in travel order: the tail fades in behind, falls
 * from 45% to the spike, and the spike cuts off ahead (the desktop's 18.75 / 25 / 31.25 / 43.75%
 * stops of its 50% period, reflected because its layer travels against the gradient line).
 */
const BAND = [0.125, 0.375, 0.5, 0.625] as const;
/** the band twice over a layer two sides long (eight stops; the assertion only restores BAND's length) */
const STOPS = [...BAND.map((u) => u / 2), ...BAND.map((u) => 0.5 + u / 2)] as [number, number, ...number[]];

function RunningArcImpl({ color, durationMs = ARC_MS }: { color?: string; durationMs?: number }) {
  const t = useTokens();
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const progress = useLoop({ durationMs }, !reduced);

  const { width, height } = size;
  // the layer is two periods long: sliding it from -side to 0 advances the band by exactly one period
  const across = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));
  const down = useAnimatedStyle(() => ({ transform: [{ translateY: (progress.value - 1) * height }] }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w !== size.width || h !== size.height) setSize({ width: w, height: h });
  };

  if (reduced) return null;

  const spike = color ?? (t.renderedMode === 'dark' ? t.dtForeground : t.dtMidground);
  const band = [transparentOf(spike), mixPct(spike, 0.45, 'transparent'), spike, transparentOf(spike)] as const;
  const colors = [...band, ...band] as const;
  const ready = width > 0 && height > 0;

  const strip = (side: 'top' | 'bottom' | 'left' | 'right') => {
    const horizontal = side === 'top' || side === 'bottom';
    return (
      <View
        key={side}
        pointerEvents="none"
        style={[
          styles.strip,
          horizontal ? { left: 0, right: 0, height: ARC_WIDTH, [side]: 0 } : { top: 0, bottom: 0, width: ARC_WIDTH, [side]: 0 },
          side === 'bottom' && styles.mirrorX,
          side === 'left' && styles.mirrorY,
        ]}
      >
        <Animated.View style={[horizontal ? { width: width * 2, height: ARC_WIDTH } : { width: ARC_WIDTH, height: height * 2 }, horizontal ? across : down]}>
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
      {ready ? [strip('top'), strip('right'), strip('bottom'), strip('left')] : null}
    </View>
  );
}

export const RunningArc = memo(RunningArcImpl);

const styles = StyleSheet.create({
  strip: { position: 'absolute', overflow: 'hidden' },
  // bottom runs right-to-left and left runs bottom-to-top: the top and right strips, reflected
  mirrorX: { transform: [{ scaleX: -1 }] },
  mirrorY: { transform: [{ scaleY: -1 }] },
});
