/**
 * Read-only source: a line-number gutter beside monospace text, no highlighting
 * (issue "Panes and desktop-only power on a phone"). The desktop's SourceView
 * windows 200-line chunks of fixed 20px rows; so does this, with the chunk's text
 * as one selectable block so a reader can select across lines.
 */

import { useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MONO, useTokens } from '../ui/tokens.ts';
import { chunkLines, maxColumns, splitLines } from './text.ts';

const FONT = 11.2;
const LINE = 20;
const CHAR = FONT * 0.6;
const CHUNK = 200;
const GUTTER_PAD = 16;

export function SourceView({ text }: { text: string }) {
  const t = useTokens();
  const { chunks, gutter, width } = useMemo(() => {
    const lines = splitLines(text);
    const digits = String(lines.length).length;
    const gutterWidth = Math.max(36, Math.ceil(digits * CHAR) + GUTTER_PAD);
    return {
      chunks: chunkLines(lines, CHUNK).map((chunk) => ({
        start: chunk.start,
        height: chunk.lines.length * LINE,
        text: chunk.lines.join('\n'),
        numbers: chunk.lines.map((_, offset) => chunk.start + offset + 1).join('\n'),
      })),
      gutter: gutterWidth,
      width: gutterWidth + Math.ceil(maxColumns(lines) * CHAR) + 28,
    };
  }, [text]);

  const offsets = useMemo(() => {
    let y = 0;
    return chunks.map((chunk) => {
      const offset = y;
      y += chunk.height;
      return offset;
    });
  }, [chunks]);

  const base = { fontFamily: MONO, fontSize: FONT, lineHeight: LINE, includeFontPadding: false } as const;

  return (
    <ScrollView horizontal nestedScrollEnabled contentContainerStyle={{ minWidth: '100%' }} style={styles.fill}>
      <FlatList
        style={{ width: Math.max(width, 1) }}
        data={chunks}
        keyExtractor={(chunk) => String(chunk.start)}
        getItemLayout={(_, index) => ({ length: chunks[index].height, offset: offsets[index], index })}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={5}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', height: item.height }}>
            <Text allowFontScaling={false} style={[base, { width: gutter, paddingRight: 8, textAlign: 'right', color: t.uiTextQuaternary }]}>
              {item.numbers}
            </Text>
            <Text allowFontScaling={false} selectable style={[base, { color: t.uiTextPrimary, paddingRight: 28 }]}>
              {item.text}
            </Text>
          </View>
        )}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
