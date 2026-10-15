/**
 * Text painted with a left-to-right gradient, the desktop's
 * `background-clip: text` over a near-horizontal `linear-gradient`. With no text
 * masking on React Native each character takes the colour at its place along
 * the run, which reads the same at label sizes and needs no native module.
 */

import { useMemo } from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { gradientColors, type GradientStop } from './gradient.ts';

export type { GradientStop };

export function GradientText({
  children,
  stops,
  style,
  ...rest
}: Omit<TextProps, 'style' | 'children'> & { children: string; stops: readonly GradientStop[]; style?: StyleProp<TextStyle> }) {
  const runs = useMemo(() => gradientColors(children, stops), [children, stops]);
  return (
    <Text {...rest} style={style} accessibilityLabel={rest.accessibilityLabel ?? children}>
      {runs.map((run, index) => (
        <Text key={index} style={{ color: run.color }}>
          {run.char}
        </Text>
      ))}
    </Text>
  );
}
