/**
 * The desktop's particle loader (components/ui/loader.tsx) on the two-prop
 * animated engine chosen in issue "Shell and loader prototype on device": a frame
 * callback publishes the curve and trail path strings from one worklet, and two
 * animated props read them, so nothing re-renders per frame.
 */

import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { useTokens } from '../tokens.ts';
import { CURVES, CURVE_OPACITY, PATH_STEPS, TRAIL_OPACITY } from './curves.ts';
import { loaderFrame, type LoaderKind } from './frame.ts';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type LoaderProps = {
  /** curve the particles trace; the desktop default is the rose curve */
  kind?: LoaderKind;
  /** side length in dp (desktop `size-N` is N x 4) */
  size?: number;
  /** defaults to the primary colour, as the desktop's `text-primary` */
  color?: string;
  strokeScale?: number;
  pathSteps?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function Loader({ kind = 'rose-curve', size = 40, color, strokeScale = 1, pathSteps = PATH_STEPS, label = 'Loading', style }: LoaderProps) {
  const t = useTokens();
  const tint = color ?? t.dtPrimary;
  const config = CURVES[kind];
  const phase = useMemo(() => Math.random(), []);
  const curveD = useSharedValue('');
  const trailD = useSharedValue('');

  useFrameCallback((frame) => {
    const next = loaderFrame(kind, config, frame.timeSinceFirstFrame, phase, strokeScale, pathSteps);
    curveD.value = next.curve;
    trailD.value = next.trail;
  });

  const curveProps = useAnimatedProps(() => ({ d: curveD.value }));
  const trailProps = useAnimatedProps(() => ({ d: trailD.value }));

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={[{ width: size, height: size }, style]}>
      <Svg fill="none" height={size} viewBox="0 0 100 100" width={size}>
        <AnimatedPath
          animatedProps={curveProps}
          fill="none"
          opacity={CURVE_OPACITY}
          stroke={tint}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={config.strokeWidth * strokeScale}
        />
        <AnimatedPath animatedProps={trailProps} fill={tint} opacity={TRAIL_OPACITY} />
      </Svg>
    </View>
  );
}
