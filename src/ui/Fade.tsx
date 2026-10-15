/**
 * The desktop's CSS fades as gradient overlays (issue "Theme and typography
 * emulation on React Native": mask-image becomes expo-linear-gradient).
 *
 * A mask resolves against whatever sits behind it; an overlay has to paint the
 * surface colour itself, so each of these takes `fadeColor`, the background the
 * content sits on. Sources: components/ui/fade-text.tsx and fade-scroll.tsx.
 */

import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type ScrollViewProps, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { transparentOf } from './color.ts';

type Edge = 'top' | 'bottom' | 'left' | 'right';

const EDGE_GRADIENT = {
  top: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  bottom: { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
  left: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  right: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
} as const;

/** Where the gradient stops: `pad` of fully hidden content, then `size` of fade. */
export function fadeStops(size: number, pad: number): [number, number, number] {
  const total = size + pad;
  return [0, total === 0 ? 0 : pad / total, 1];
}

/** A fade into `color` along one edge of its parent, over `pad` of solid colour then `size` of gradient. */
export function FadeEdge({ edge, size, color, pad = 0 }: { edge: Edge; size: number; color: string; pad?: number }) {
  const horizontal = edge === 'left' || edge === 'right';
  const { start, end } = EDGE_GRADIENT[edge];
  const thickness = size + pad;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[color, color, transparentOf(color)]}
      locations={fadeStops(size, pad)}
      start={start}
      end={end}
      style={[
        styles.edge,
        horizontal ? { top: 0, bottom: 0, width: thickness } : { left: 0, right: 0, height: thickness },
        { [edge]: 0 },
      ]}
    />
  );
}

/**
 * One line of text that fades out at the right edge instead of truncating with an
 * ellipsis. The fade only appears when the text actually overflows, so short
 * strings render as plain text.
 */
export function FadeText({
  children,
  style,
  fadeColor,
  fadeWidth = 48,
  ...rest
}: Omit<TextProps, 'numberOfLines' | 'ellipsizeMode' | 'style'> & { style?: StyleProp<TextStyle>; fadeColor: string; fadeWidth?: number; children?: ReactNode }) {
  const [box, setBox] = useState(0);
  const [natural, setNatural] = useState(0);
  const overflowing = natural - box > 1;
  return (
    <View style={styles.fadeText} onLayout={(event) => setBox(event.nativeEvent.layout.width)}>
      <Text {...rest} style={style} numberOfLines={1} ellipsizeMode="clip">
        {children}
      </Text>
      {/* an unconstrained twin measures the line's natural width, which a clipped Text never reports */}
      <Text
        {...rest}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        numberOfLines={1}
        style={[style, styles.measure]}
        onTextLayout={(event) => setNatural(event.nativeEvent.lines[0]?.width ?? 0)}
      >
        {children}
      </Text>
      {overflowing ? <FadeEdge edge="right" size={Math.min(fadeWidth, box)} color={fadeColor} /> : null}
    </View>
  );
}

/**
 * A height-capped scroller whose clipped edges fade out. A side fades only while
 * content is clipped behind it, so a list that fits shows no gradient, and a list
 * scrolled to the bottom stops fading its last row. `pad` is the scroller's own
 * padding, so the fade starts at the content instead of spending itself on the padding.
 */
export function FadeScroll({
  fadeColor,
  maxHeight,
  fade = 20,
  pad = 0,
  children,
  onScroll,
  onContentSizeChange,
  onLayout,
  ...rest
}: ScrollViewProps & { fadeColor: string; maxHeight: number; fade?: number; pad?: number }) {
  const [sizes, setSizes] = useState({ viewport: 0, content: 0 });
  const [offset, setOffset] = useState(0);

  const above = offset > 1;
  const below = sizes.viewport > 0 && offset + sizes.viewport < sizes.content - 1;

  return (
    <View style={{ maxHeight }}>
      <ScrollView
        {...rest}
        style={[{ maxHeight }, rest.style]}
        scrollEventThrottle={16}
        onScroll={(event) => {
          setOffset(event.nativeEvent.contentOffset.y);
          onScroll?.(event);
        }}
        onLayout={(event) => {
          setSizes((prev) => ({ ...prev, viewport: event.nativeEvent.layout.height }));
          onLayout?.(event);
        }}
        onContentSizeChange={(width, height) => {
          setSizes((prev) => ({ ...prev, content: height }));
          onContentSizeChange?.(width, height);
        }}
      >
        {children}
      </ScrollView>
      {above ? <FadeEdge edge="top" size={fade} pad={pad} color={fadeColor} /> : null}
      {below ? <FadeEdge edge="bottom" size={fade} pad={pad} color={fadeColor} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute' },
  fadeText: { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  measure: { position: 'absolute', left: 0, top: 0, width: 4096, opacity: 0 },
});
