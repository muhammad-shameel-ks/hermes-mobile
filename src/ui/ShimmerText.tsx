/**
 * One line of text with the desktop's `shimmer` sweep (see shimmer.ts): a soft
 * highlight band crosses the glyphs left to right, pauses, and goes again.
 * Under reduced motion the text is still.
 *
 * The band is a stack of clipped windows over the base text, each carrying a
 * highlight copy. Every window shares one animated transform and every copy shares
 * the opposite one, so a label costs two style mappers whatever its window count,
 * and the sweep reads the app's shared loop (clock.ts) instead of owning a timeline.
 * Only `transform` moves, which applies on the UI thread without a shadow-tree commit.
 */

import { memo, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

import { useLoop } from './clock.ts';
import { shimmerCentre, shimmerHighlight, shimmerRings, shimmerSweepShare, shimmerTiming } from './shimmer.ts';
import { useTokens } from './tokens.ts';

type Props = {
  children: string;
  style: StyleProp<TextStyle>;
  fontSize: number;
  /** the colour the band's centre turns the text toward, and how far; the transcript scaffold's by default */
  highlight?: { color: string; peak: number };
};

/** the highlight for text in the transcript's scaffold ink on the chat surface */
export function useScaffoldShimmer(): { color: string; peak: number } {
  const t = useTokens();
  return useMemo(
    () => shimmerHighlight(t.conversationScaffoldText, t.uiChatSurfaceBackground, t.renderedMode === 'dark'),
    [t.conversationScaffoldText, t.uiChatSurfaceBackground, t.renderedMode],
  );
}

function ShimmerTextImpl({ children, style, fontSize, highlight: given }: Props) {
  const fallback = useScaffoldShimmer();
  const highlight = given ?? fallback;
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);

  return (
    <View style={styles.root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text numberOfLines={1} style={style}>
        {children}
      </Text>
      {!reduced && width > 0 ? (
        <Band style={style} fontSize={fontSize} color={highlight.color} peak={highlight.peak} width={width}>
          {children}
        </Band>
      ) : null}
    </View>
  );
}

/** the label's props that decide what it paints; callers build `style` fresh every render, so it compares by value */
function samePaint(a: Props, b: Props): boolean {
  if (a.children !== b.children || a.fontSize !== b.fontSize || a.highlight?.color !== b.highlight?.color || a.highlight?.peak !== b.highlight?.peak) return false;
  const left = StyleSheet.flatten(a.style) as Record<string, unknown> | undefined;
  const right = StyleSheet.flatten(b.style) as Record<string, unknown> | undefined;
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const x = left[key];
    const y = right[key];
    return x === y || (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((item, i) => item === y[i]));
  });
}

export const ShimmerText = memo(ShimmerTextImpl, samePaint);

type BandProps = { children: string; style: StyleProp<TextStyle>; fontSize: number; color: string; peak: number; width: number };

function Band({ children, style, fontSize, color, peak, width }: BandProps) {
  const timing = useMemo(() => shimmerTiming(fontSize), [fontSize]);
  const rings = useMemo(() => shimmerRings(timing.spread, peak), [timing.spread, peak]);
  const loop = useLoop({ durationMs: timing.sweepMs + timing.delayMs });

  // the widest window anchors the shared transforms; each ring sits at a fixed offset from it
  const anchor = rings[0].halfWidth;
  const share = shimmerSweepShare(timing);
  const from = -timing.spread / 2;
  const to = width + timing.spread / 2;
  const frame = useAnimatedStyle(() => ({ transform: [{ translateX: shimmerCentre(loop.value, share, from, to) - anchor }] }));
  const counter = useAnimatedStyle(() => ({ transform: [{ translateX: anchor - shimmerCentre(loop.value, share, from, to) }] }));

  return (
    <>
      {rings.map((ring, index) => {
        const inset = anchor - ring.halfWidth;
        return (
          <Animated.View
            key={index}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.window, { left: inset, width: ring.halfWidth * 2, opacity: ring.opacity }, frame]}
          >
            <Animated.Text numberOfLines={1} style={[style, styles.copy, { color, width, left: -inset }, counter]}>
              {children}
            </Animated.Text>
          </Animated.View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flexShrink: 1, minWidth: 0 },
  window: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  copy: { position: 'absolute', top: 0 },
});
