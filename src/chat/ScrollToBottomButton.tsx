/**
 * The floating jump-to-bottom pill (desktop app/chat/scroll-to-bottom-button):
 * centred just above the composer, shown once the reader leaves the tail, with
 * a springing count of the messages below the fold. It never animates before
 * its first appearance, so it cannot flash on mount.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Codicon } from '../ui/Codicon.tsx';
import { useTokens } from '../ui/tokens.ts';
import { jumpLabel, messageCountLabel } from './scroll.ts';

// styles.css .thread-jump-button: in 200 ms from scale 1.1, out 180 ms ease-in to 0.9, both 0.3rem low
const SHIFT = 5;
const IN = { duration: 200, easing: Easing.bezier(0.22, 1, 0.36, 1), reduceMotion: ReduceMotion.Never };
const OUT = { duration: 180, easing: Easing.bezier(0.42, 0, 1, 1), reduceMotion: ReduceMotion.Never };
const REDUCED = { duration: 120, easing: Easing.linear, reduceMotion: ReduceMotion.Never };
/** desktop components/ui/diff-count: the snappy spring */
const SPRING = { stiffness: 320, damping: 30, mass: 0.5 };

export function ScrollToBottomButton({ visible, count, onPress }: { visible: boolean; count: number; onPress: () => void }) {
  const t = useTokens();
  const reduced = useReducedMotion();
  const shown = useRef(false);
  const opacity = useSharedValue(0);
  const shift = useSharedValue(SHIFT);
  const scale = useSharedValue(0.9);

  useEffect(() => {
    if (!visible && !shown.current) return;
    shown.current = true;
    if (reduced) {
      shift.value = 0;
      scale.value = 1;
      opacity.value = withTiming(visible ? 1 : 0, REDUCED);
      return;
    }
    if (visible) {
      opacity.value = 0;
      shift.value = SHIFT;
      scale.value = 1.1;
      opacity.value = withTiming(1, IN);
      shift.value = withTiming(0, IN);
      scale.value = withTiming(1, IN);
    } else {
      opacity.value = withTiming(0, OUT);
      shift.value = withTiming(SHIFT, OUT);
      scale.value = withTiming(0.9, OUT);
    }
  }, [visible, reduced, opacity, shift, scale]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: shift.value }, { scale: scale.value }],
  }));

  const countLabel = count > 0 ? messageCountLabel(count) : '';
  const [before, after] = countLabel ? countLabel.split(String(count)) : ['', ''];

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!visible}
      style={[styles.anchor, animated]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={jumpLabel(count)}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary },
          pressed && { backgroundColor: t.uiControlHoverBackground },
        ]}
      >
        <Codicon name="arrow-down" size={14} color={t.uiTextTertiary} />
        <Text style={[styles.label, { color: t.uiTextTertiary }]} numberOfLines={1}>
          {count > 0 ? (
            <>
              {before}
              {visible && !reduced ? <SpringInt value={count} /> : count}
              {after}
            </>
          ) : (
            'Scroll to bottom'
          )}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** An integer that starts at its value and springs to each later one. */
function SpringInt({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const spring = useSharedValue(value);

  useEffect(() => {
    spring.value = withSpring(value, SPRING);
  }, [value, spring]);

  useAnimatedReaction(
    () => Math.round(spring.value),
    (next, previous) => {
      if (next !== previous) runOnJS(setShown)(next);
    },
  );

  return <>{shown}</>;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
  // h-8 rounded-full border px-3 gap-1.5 text-xs font-medium
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  label: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
