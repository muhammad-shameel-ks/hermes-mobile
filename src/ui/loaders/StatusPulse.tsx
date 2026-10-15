/**
 * The desktop's status pulse (components/ui/status-pulse.tsx): a 400 ms cue that
 * replays on one shared 5 s beat, with the app asleep between plays.
 */

import { useEffect, type ReactNode } from 'react';
import { AppState, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { createPulseClock, PULSE_DURATION_MS } from './pulse.ts';

const clock = createPulseClock();
AppState.addEventListener('change', (state) => clock.setPaused(state !== 'active'));

export type StatusPulseProps = {
  /** `opacity` dips to half and back; `ping` grows to twice its size while fading out */
  kind: 'opacity' | 'ping';
  /** starting opacity of a `ping` */
  opacity?: number;
  style?: StyleProp<ViewStyle>;
  /** what pulses, when it is more than a filled box (the dither square) */
  children?: ReactNode;
};

export function StatusPulse({ kind, opacity = 1, style, children }: StatusPulseProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    const play = () => {
      cancelAnimation(progress);
      progress.value = 0;
      progress.value =
        kind === 'ping'
          ? withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.bezier(0, 0, 0.2, 1) })
          : withSequence(
              withTiming(1, { duration: PULSE_DURATION_MS / 2, easing: Easing.inOut(Easing.ease) }),
              withTiming(0, { duration: PULSE_DURATION_MS / 2, easing: Easing.inOut(Easing.ease) }),
            );
    };
    const cancel = () => {
      cancelAnimation(progress);
      progress.value = 0;
    };
    const unsubscribe = clock.subscribe({ play, cancel });
    return () => {
      unsubscribe();
      cancel();
    };
  }, [kind, reduced, progress]);

  const animated = useAnimatedStyle(() =>
    kind === 'ping' ? { opacity: opacity * (1 - progress.value), transform: [{ scale: 1 + progress.value }] } : { opacity: 1 - progress.value * 0.5 },
  );

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
