/**
 * The math face with its face clock: head sway, gaze, blinks, and the working
 * dots, painted from pure poses (face.ts). Each face runs one frame callback on
 * the UI thread, throttled to the desktop's 15 fps budget; the callback stops
 * with the component, so a face the drawer or screen has unmounted costs nothing,
 * and while the app is in the background.
 */

import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { useAppForeground } from '../ui/clock.ts';
import { faceFrame, facePose, faceGeometry, settlePose, type FaceMood, type PoseTransition } from './face.ts';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

/** avatar.tsx: the clock repaints at 15 fps, which is smooth at avatar scale */
const FRAME_S = 1 / 15;
/** the dots sit under the body in the 40x44 box */
const DOT_Y = 41.2;

// memo: a re-render hands `useFrameCallback` a new worklet, which unregisters and re-registers it on the UI thread
export const AnimatedFace = memo(function AnimatedFace({ shape, color, mood, size }: { shape: string; color: string; mood: FaceMood; size: number }) {
  const { eyeFill, highlightFill } = faceGeometry(shape, color);
  const working = mood !== 'idle';
  const rest = faceFrame(shape, facePose(mood, 0));

  const moodValue = useSharedValue<string>(mood);
  const frame = useSharedValue(rest);
  const transition = useSharedValue<PoseTransition | null>(null);
  const lastPaint = useSharedValue(0);

  useEffect(() => {
    moodValue.value = mood;
  }, [mood, moodValue]);

  const clock = useFrameCallback((info) => {
    const t = info.timestamp / 1000;
    if (t - lastPaint.value < FRAME_S - 0.004) return;
    lastPaint.value = t;
    const current = moodValue.value;
    const next = settlePose(transition.value, current, facePose(current, t), t);
    transition.value = next;
    frame.value = faceFrame(shape, next.pose);
  });

  const foreground = useAppForeground();
  useEffect(() => {
    if (foreground) return;
    clock.setActive(false);
    return () => {
      if (clock.callbackId !== -1) clock.setActive(true);
    };
  }, [clock, foreground]);

  const body = useAnimatedProps(() => ({ d: frame.value.body }));
  const eyeL = useAnimatedProps(() => ({ cx: frame.value.eyeL, cy: frame.value.eyeY }));
  const eyeR = useAnimatedProps(() => ({ cx: frame.value.eyeR, cy: frame.value.eyeY }));
  const hlL = useAnimatedProps(() => ({ cx: frame.value.hlL, cy: frame.value.hlY }));
  const hlR = useAnimatedProps(() => ({ cx: frame.value.hlR, cy: frame.value.hlY }));
  const open = useAnimatedProps(() => ({ opacity: frame.value.open }));
  const shut = useAnimatedProps(() => ({ d: frame.value.shut, opacity: frame.value.shutOpacity }));
  const dot0 = useAnimatedProps(() => ({ opacity: frame.value.d0 }));
  const dot1 = useAnimatedProps(() => ({ opacity: frame.value.d1 }));
  const dot2 = useAnimatedProps(() => ({ opacity: frame.value.d2 }));
  // the desktop rotates about 50% 70% of the face box
  const tilt = useAnimatedStyle(() => ({
    transform: [{ translateY: size * 0.2 }, { rotate: `${frame.value.tilt}deg` }, { translateY: -size * 0.2 }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, tilt]}>
      <Svg width={size} height={size} viewBox="0 0 40 44" style={styles.overflow}>
        <AnimatedPath d={rest.body} fill={color} animatedProps={body} />
        <AnimatedG opacity={rest.open} animatedProps={open}>
          <AnimatedEllipse cx={rest.eyeL} cy={rest.eyeY} rx={2.2} ry={working ? 2.6 : 2.3} fill={eyeFill} animatedProps={eyeL} />
          <AnimatedEllipse cx={rest.eyeR} cy={rest.eyeY} rx={2.2} ry={working ? 2.6 : 2.3} fill={eyeFill} animatedProps={eyeR} />
          <AnimatedCircle cx={rest.hlL} cy={rest.hlY} r={0.65} fill={highlightFill} animatedProps={hlL} />
          <AnimatedCircle cx={rest.hlR} cy={rest.hlY} r={0.65} fill={highlightFill} animatedProps={hlR} />
        </AnimatedG>
        <AnimatedPath d={rest.shut} fill="none" stroke={eyeFill} strokeWidth={2} strokeLinecap="round" opacity={rest.shutOpacity} animatedProps={shut} />
        <AnimatedCircle cx={16.4} cy={DOT_Y} r={1.15} fill={color} opacity={rest.d0} animatedProps={dot0} />
        <AnimatedCircle cx={20} cy={DOT_Y} r={1.15} fill={color} opacity={rest.d1} animatedProps={dot1} />
        <AnimatedCircle cx={23.6} cy={DOT_Y} r={1.15} fill={color} opacity={rest.d2} animatedProps={dot2} />
      </Svg>
    </Animated.View>
  );
});

const styles = StyleSheet.create({ overflow: { overflow: 'visible' } });
