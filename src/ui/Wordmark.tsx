/**
 * The Wordmark: Collapse Bold, uppercase, 0.08em tracking, 0.9 leading, sized so
 * the word fills its width (desktop `.wordmark.fit-text`, floor 2.75rem). The
 * desktop fits with container-query maths; here the word is measured once at a
 * reference size and scaled linearly, which is exact because tracking is in em.
 */

import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTokens, WORDMARK_FONT } from './tokens.ts';

const REFERENCE = 100;
const FIT_MIN = 44;
const TRACKING = 0.08;

export function Wordmark({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState(0);
  // a hair under the exact fit: line widths round differently across sizes, and a 1px overflow would ellipsize
  const size = width && measured ? Math.max(FIT_MIN, (REFERENCE * width * 0.98) / measured) : 0;
  const upper = text.toUpperCase();

  return (
    <View style={[styles.box, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="header" accessibilityLabel={text}>
      <Text
        style={[styles.word, styles.probe, { fontSize: REFERENCE, letterSpacing: REFERENCE * TRACKING }]}
        allowFontScaling={false}
        numberOfLines={1}
        onTextLayout={(e) => {
          const line = e.nativeEvent.lines[0];
          if (line && Math.abs(line.width - measured) > 0.5) setMeasured(line.width);
        }}
        accessible={false}
      >
        {upper}
      </Text>
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
