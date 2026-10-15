/**
 * An image that pinches, pans and double-taps, shared by the chat lightbox and
 * the Files preview. The gestures run on the UI thread through gesture-handler
 * and write Reanimated shared values; the maths and the desktop's 0.25-8x limits
 * live in zoom.ts. Panning only moves a picture that overflows the stage, a
 * double tap zooms in on the tap or resets, and a swipe on a fitted picture
 * reports to the pager.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Image, StyleSheet, View, type ImageLoadEventData, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { clampView, containSize, doubleTapView, IDENTITY, pinchView, zoomAbout, type Size, type View as ZoomView } from './zoom.ts';

export type ZoomHandle = {
  /** zoom about the centre by a factor, within the limits */
  zoomBy: (factor: number) => void;
  reset: () => void;
};

const SWIPE_PX = 80;
const TAP_PX = 6;
const DOUBLE_TAP_MS = 250;
const ANIMATION = { duration: 160, easing: Easing.out(Easing.cubic) };

export function ZoomableImage({
  uri,
  alt,
  onTap,
  onSwipe,
  onScale,
  ref,
}: {
  uri: string;
  alt?: string;
  /** a clean single tap */
  onTap?: () => void;
  /** a horizontal swipe while the picture is fitted: 1 for next, -1 for previous */
  onSwipe?: (step: 1 | -1) => void;
  onScale?: (scale: number) => void;
  ref?: Ref<ZoomHandle>;
}) {
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size | null>(null);
  const content = useMemo(() => (natural ? containSize(natural, stage) : stage), [natural, stage]);

  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const start = useSharedValue<ZoomView>(IDENTITY);
  const panStart = useSharedValue<ZoomView>(IDENTITY);
  const focal = useSharedValue({ x: 0, y: 0 });
  const stageSize = useSharedValue<Size>(stage);
  const contentSize = useSharedValue<Size>(content);

  useEffect(() => {
    stageSize.value = stage;
    contentSize.value = content;
  }, [stage, content, stageSize, contentSize]);

  const callbacks = useRef({ onTap, onSwipe, onScale });
  callbacks.current = { onTap, onSwipe, onScale };
  const tap = useCallback(() => callbacks.current.onTap?.(), []);
  const swipe = useCallback((step: 1 | -1) => callbacks.current.onSwipe?.(step), []);
  const report = useCallback((percent: number) => callbacks.current.onScale?.(percent / 100), []);

  useAnimatedReaction(
    () => Math.round(scale.value * 100),
    (percent, previous) => {
      if (percent !== previous) scheduleOnRN(report, percent);
    },
  );

  const animateTo = useCallback(
    (view: ZoomView) => {
      scale.value = withTiming(view.scale, ANIMATION);
      x.value = withTiming(view.x, ANIMATION);
      y.value = withTiming(view.y, ANIMATION);
    },
    [scale, x, y],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor) => animateTo(zoomAbout({ scale: scale.value, x: x.value, y: y.value }, scale.value * factor, { x: 0, y: 0 }, content, stage)),
      reset: () => animateTo(IDENTITY),
    }),
    [animateTo, content, stage, scale, x, y],
  );

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart((event) => {
        start.value = { scale: scale.value, x: x.value, y: y.value };
        focal.value = { x: event.focalX - stageSize.value.width / 2, y: event.focalY - stageSize.value.height / 2 };
      })
      .onUpdate((event) => {
        const to = { x: event.focalX - stageSize.value.width / 2, y: event.focalY - stageSize.value.height / 2 };
        const view = pinchView(start.value, event.scale, focal.value, to, contentSize.value, stageSize.value);
        scale.value = view.scale;
        x.value = view.x;
        y.value = view.y;
      });

    // a pinch carries its own midpoint movement, so the pan takes one finger only
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(TAP_PX)
      .onStart(() => {
        panStart.value = { scale: scale.value, x: x.value, y: y.value };
      })
      .onUpdate((event) => {
        const fitted = Math.abs(scale.value - 1) <= 0.01;
        if (fitted) return;
        const view = clampView(
          { scale: scale.value, x: panStart.value.x + event.translationX, y: panStart.value.y + event.translationY },
          contentSize.value,
          stageSize.value,
        );
        x.value = view.x;
        y.value = view.y;
      })
      .onEnd((event) => {
        const fitted = Math.abs(scale.value - 1) <= 0.01;
        const horizontal = Math.abs(event.translationX) > SWIPE_PX && Math.abs(event.translationX) > Math.abs(event.translationY) * 1.5;
        if (fitted && horizontal) scheduleOnRN(swipe, event.translationX < 0 ? 1 : -1);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(TAP_PX)
      .maxDelay(DOUBLE_TAP_MS)
      .onEnd((event, success) => {
        if (!success) return;
        const to = { x: event.x - stageSize.value.width / 2, y: event.y - stageSize.value.height / 2 };
        const view = doubleTapView({ scale: scale.value, x: x.value, y: y.value }, to, contentSize.value, stageSize.value);
        scale.value = withTiming(view.scale, ANIMATION);
        x.value = withTiming(view.x, ANIMATION);
        y.value = withTiming(view.y, ANIMATION);
      });

    const singleTap = Gesture.Tap()
      .maxDistance(TAP_PX)
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(tap);
      });

    return Gesture.Race(Gesture.Exclusive(doubleTap, singleTap), Gesture.Simultaneous(pan, pinch));
  }, [contentSize, focal, panStart, scale, stageSize, start, swipe, tap, x, y]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  const onLoad = (event: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = event.nativeEvent.source;
    setNatural({ width, height });
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.stage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setStage({ width, height });
        }}
      >
        <Animated.View style={[styles.center, imageStyle]} pointerEvents="none">
          {stage.width > 0 ? (
            <Image
              source={{ uri }}
              resizeMode="contain"
              accessibilityLabel={alt || 'Image'}
              onLoad={onLoad}
              style={{ width: content.width, height: content.height }}
            />
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
