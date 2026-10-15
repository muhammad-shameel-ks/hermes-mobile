/**
 * The desktop's glyph spinner (components/ui/glyph-spinner.tsx + .css): every
 * frame is mounted as a vertical strip inside a one-line clipping viewport and a
 * stepped travel scrolls it a frame at a time, so there is no timer and no
 * per-frame text swap. The steps come from the app's shared loop (clock.ts), one
 * timeline for every spinner of a kind, and the strip's frames are built once.
 */

import { memo, useMemo } from 'react';
import { Platform, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { useLoop } from '../clock.ts';
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

function GlyphSpinnerImpl({ spinner = 'braille', size = 12, color, paused = false, label = 'Loading', style }: GlyphSpinnerProps) {
  const t = useTokens();
  const { frames, interval } = GLYPH_SPINNERS[spinner];
  const count = frames.length;
  const loop = useLoop({ durationMs: count * interval, steps: count }, !paused);
  const ink = color ?? t.uiTextTertiary;

  // the strip only moves when the step changes: a derived value stops equal results from reaching the style mapper and the native view
  const step = useDerivedValue(() => (paused ? 0 : Math.round(loop.value * count)));
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -step.value * size }] }));

  const cells = useMemo(
    () =>
      glyphStrip(spinner).map((frame, index) => (
        <Text
          key={index}
          allowFontScaling={false}
          style={{ color: ink, fontFamily: GLYPH_FONT, fontSize: size, lineHeight: size, height: size, width: size, textAlign: 'center', includeFontPadding: false }}
        >
          {frame}
        </Text>
      )),
    [spinner, size, ink],
  );

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={[{ width: size, height: size, overflow: 'hidden' }, style]}>
      <Animated.View style={stripStyle} importantForAccessibility="no-hide-descendants">
        {cells}
      </Animated.View>
    </View>
  );
}

export const GlyphSpinner = memo(GlyphSpinnerImpl);
