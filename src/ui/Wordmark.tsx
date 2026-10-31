/**
 * The Wordmark: Collapse Bold, uppercase, 0.08em tracking, 0.9 leading, sized so
 * the word fills its width (desktop `.wordmark.fit-text`, floor 2.75rem). The
 * desktop fits with container-query maths; here the word is measured once at a
 * reference size and scaled linearly, which is exact because tracking is in em.
 * What a mount learns (the word's reference width, the box's width) is remembered
 * per text (`wordmarkFit.ts`), so the next mount sizes itself on its first render.
 */

import { useState } from 'react';
import { isLoaded } from 'expo-font';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useTokens, WORDMARK_FONT } from './tokens.ts';
import { createFitMemo, fitSize, REFERENCE, TRACKING, type Fit } from './wordmarkFit.ts';

const memo = createFitMemo();

type Laid = Fit & { text: string };

export function Wordmark({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const upper = text.toUpperCase();
  const [laid, setLaid] = useState<Laid>(() => ({ text: upper, ...memo.recall(upper) }));
  // another word in the same box (a bot's label after another's) starts from what is known of it
  if (laid.text !== upper) setLaid({ text: upper, ...memo.recall(upper) });
  const { width, measured } = laid;
  const size = fitSize(width, measured);
  // a measure taken in the real face is final: the off-screen probe is laid out only until one exists
  const probing = memo.recall(upper).measured === 0;

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    memo.noteWidth(upper, next);
    setLaid((prev) => (prev.text === upper && Math.abs(prev.width - next) <= 0.5 ? prev : { ...prev, text: upper, width: next }));
  };

  return (
    <View style={[styles.box, style]} onLayout={onLayout} accessibilityRole="header" accessibilityLabel={text}>
      {probing ? (
        <Text
          style={[styles.word, styles.probe, { fontSize: REFERENCE, letterSpacing: REFERENCE * TRACKING }]}
          allowFontScaling={false}
          numberOfLines={1}
          onTextLayout={(e) => {
            const line = e.nativeEvent.lines[0];
            if (!line) return;
            if (isLoaded(WORDMARK_FONT)) memo.noteMeasured(upper, line.width);
            setLaid((prev) => (prev.text === upper && Math.abs(prev.measured - line.width) <= 0.5 ? prev : { ...prev, text: upper, measured: line.width }));
          }}
          accessible={false}
        >
          {upper}
        </Text>
      ) : null}
      {size ? (
        <Text
          style={[styles.word, { color: t.uiWordmark, fontSize: size, lineHeight: size * 0.9, letterSpacing: size * TRACKING, paddingTop: size * 0.06 }]}
          allowFontScaling={false}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessible={false}
        >
          {upper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', alignItems: 'center' },
  word: { fontFamily: WORDMARK_FONT, includeFontPadding: false, textAlign: 'center' },
  // laid out off-screen without a width cap so the line reports its natural width
  probe: { position: 'absolute', opacity: 0, left: 0, top: 0, width: 4000, textAlign: 'left' },
});
