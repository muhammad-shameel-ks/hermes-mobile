/**
 * DecodeText: the desktop's scramble-decode word (components/ui/decode-text.tsx),
 * the "CONNECTING" of the boot overlay. Mono, small, uppercase, tracked at 0.4em;
 * the first `prefix` characters stay legible; an optional dithered cursor square
 * blinks after it (step-end, 1 s). Under reduced motion the word renders resolved.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { DECODE_START, DECODE_TICK_MS, decodeTick } from './decode.ts';
import { MONO_MEDIUM } from './tokens.ts';

const FONT_SIZE = 10.24;
const TRACKING = FONT_SIZE * 0.4;
const CURSOR_CELL = 2;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => live && setReduced(value));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** the `.dither` square: a 2 px checkerboard, 8 px across */
function DitherCursor({ color }: { color: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((value) => !value), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={[styles.cursor, { opacity: on ? 1 : 0 }]} accessible={false}>
      {Array.from({ length: 16 }, (_, i) => (
        <View key={i} style={{ width: CURSOR_CELL, height: CURSOR_CELL, backgroundColor: (Math.floor(i / 4) + (i % 4)) % 2 === 0 ? color : 'transparent' }} />
      ))}
    </View>
  );
}

export function DecodeText({
  text,
  color,
  prefix = 0,
  active = true,
  loop = false,
  cursor = false,
}: {
  text: string;
  color: string;
  prefix?: number;
  active?: boolean;
  loop?: boolean;
  cursor?: boolean;
}) {
  const reduced = useReducedMotion();
  const staticPrefix = text.slice(0, prefix);
  const tailText = text.slice(prefix);
  const [tail, setTail] = useState(tailText);

  useEffect(() => {
    if (!active || reduced) {
      setTail(tailText);
      return;
    }
    let state = DECODE_START;
    const id = setInterval(() => {
      const tick = decodeTick(state, tailText, loop);
      state = tick.state;
      setTail(tick.text);
      if (tick.stop) clearInterval(id);
    }, DECODE_TICK_MS);
    return () => clearInterval(id);
  }, [active, reduced, loop, tailText]);

  return (
    <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel={text}>
      <Text allowFontScaling={false} style={[styles.word, { color }]}>
        {staticPrefix}
        {tail}
      </Text>
      {cursor ? <DitherCursor color={color} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // `pl-[0.4em]` balances the tracking trailing the last letter
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: TRACKING },
  word: { fontFamily: MONO_MEDIUM, fontSize: FONT_SIZE, letterSpacing: TRACKING, textTransform: 'uppercase', includeFontPadding: false },
  cursor: { width: CURSOR_CELL * 4, height: CURSOR_CELL * 4, flexDirection: 'row', flexWrap: 'wrap', marginLeft: 2, transform: [{ translateY: -1 }] },
});
