/**
 * Inline code as the desktop draws it: upright mono on a gray chip with rounded
 * ends. React Native cannot round the background of text nested in a line, so
 * each word is a small inline view and the gaps between words are spacers of
 * the same fill; a span longer than the line still wraps between words, and
 * only its first and last pieces have rounded ends.
 */

import { Fragment, memo } from 'react';
import { Text, View, type TextStyle } from 'react-native';

const RADIUS = 4;
const PAD = 4;

/** `alpha`: how far a streamed reply's reveal has inked this span (streamFade.ts); the chip and its text fade together */
function InlineCodeImpl({ text, style, alpha = 1 }: { text: string; style: TextStyle; alpha?: number }) {
  const fontSize = style.fontSize ?? 14;
  const height = Math.round(fontSize * 1.5);
  const backgroundColor = style.backgroundColor;
  // an inline view rests its bottom edge on the baseline; dropping it by about the font's descent centres the text on its neighbours
  const drop = [{ translateY: Math.round(fontSize * 0.22) }];
  const opacity = alpha < 1 ? alpha : undefined;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return <Text style={style}>{text}</Text>;

  return (
    <>
      {words.map((word, index) => {
        const first = index === 0;
        const last = index === words.length - 1;
        return (
          <Fragment key={index}>
            {first ? null : <View style={{ width: fontSize * 0.6, height, backgroundColor, transform: drop, opacity }} />}
            <View
              style={{
                height,
                transform: drop,
                justifyContent: 'center',
                backgroundColor,
                opacity,
                paddingLeft: first ? PAD : 0,
                paddingRight: last ? PAD : 0,
                borderTopLeftRadius: first ? RADIUS : 0,
                borderBottomLeftRadius: first ? RADIUS : 0,
                borderTopRightRadius: last ? RADIUS : 0,
                borderBottomRightRadius: last ? RADIUS : 0,
              }}
            >
              <Text style={{ ...style, backgroundColor: undefined, lineHeight: height }}>{word}</Text>
            </View>
          </Fragment>
        );
      })}
    </>
  );
}

/** the parser hands every codespan a fresh style object each parse, so props are compared by value */
export const InlineCode = memo(InlineCodeImpl, (before, after) => {
  if (before.text !== after.text || before.alpha !== after.alpha) return false;
  if (before.style === after.style) return true;
  const keys = Object.keys(before.style) as (keyof TextStyle)[];
  return keys.length === Object.keys(after.style).length && keys.every((key) => before.style[key] === after.style[key]);
});
