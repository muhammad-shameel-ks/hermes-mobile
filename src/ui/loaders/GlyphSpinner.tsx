/**
 * The desktop's glyph spinner (components/ui/glyph-spinner.tsx + .css): every
 * frame is mounted as a vertical strip inside a one-line clipping viewport and a
 * stepped Reanimated travel scrolls it a frame at a time, so there is no timer
 * and no per-frame text swap.
 */

import { useEffect } from 'react';
import { Platform, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useTokens } from '../tokens.ts';
import { GLYPH_SPINNERS, glyphStrip, type GlyphSpinnerName } from './curves.ts';

// braille is not in JetBrains Mono: the platform monospace face supplies it, as the desktop's fallback does
const GLYPH_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

export type GlyphSpinnerProps = {
  spinner?: GlyphSpinnerName;
  /** font size and cell size in dp */
  size?: number;
  color?: string;
  /** hold still while staying mounted, for a caller fading it out */
  paused?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function GlyphSpinner({ spinner = 'braille', size = 12, color, paused = false, label = 'Loading', style }: GlyphSpinnerProps) {
  const t = useTokens();
  const { frames, interval } = GLYPH_SPINNERS[spinner];
  const offset = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(offset);
    offset.value = 0;
    if (paused) return;
    offset.value = withRepeat(
      withTiming(-frames.length * size, { duration: frames.length * interval, easing: Easing.steps(frames.length, true) }),
      -1,
      false,
    );
    return () => cancelAnimation(offset);
  }, [offset, frames.length, interval, size, paused]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={[{ width: size, height: size, overflow: 'hidden' }, style]}>
      <Animated.View style={stripStyle} importantForAccessibility="no-hide-descendants">
        {glyphStrip(spinner).map((frame, index) => (
          <Text
            key={index}
            allowFontScaling={false}
            style={{
              color: color ?? t.uiTextTertiary,
              fontFamily: GLYPH_FONT,
              fontSize: size,
              lineHeight: size,
              height: size,
              width: size,
              textAlign: 'center',
              includeFontPadding: false,
            }}
          >
            {frame}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}
