/**
 * A unified diff as fixed 20px rows (desktop `FileDiffPanel`, windowed): the new
 * line number in a gutter, a tinted row with an accent edge for each add or
 * remove, and an overview ruler of change ticks pinned to the right edge. Colour
 * only, no highlighting. The list scrolls sideways as a whole so tints span the
 * widest line.
 */

import { memo, useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';

import { displayLine, MAX_COLUMNS } from '../files/text.ts';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { gutterDigits, overviewRuns, type DiffLine } from './diff.ts';

const FONT = 11.2;
const LINE = 20;
const CHAR = FONT * 0.6;

type RowProps = { row: DiffLine; text: string; gutter: number; width: number; t: Tokens };

const Row = memo(function Row({ row, text, gutter, width, t }: RowProps) {
  const add = row.kind === 'add';
  const remove = row.kind === 'remove';
  const font = { fontFamily: MONO, fontSize: FONT, lineHeight: LINE, includeFontPadding: false } as const;
  return (
    <View
      style={{
        width,
        height: LINE,
        flexDirection: 'row',
        backgroundColor: add ? t.uiDiffAddBackground : remove ? t.uiDiffRemoveBackground : undefined,
      }}
    >
      <Text allowFontScaling={false} style={[font, { width: gutter, paddingRight: 8, textAlign: 'right', color: t.uiTextQuaternary }]}>
        {row.newNo ?? ''}
      </Text>
      <View style={{ width: 2, backgroundColor: add ? t.uiDiffAddBorder : remove ? t.uiDiffRemoveBorder : 'transparent' }} />
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[font, { paddingLeft: 10, color: add ? t.uiDiffAddForeground : remove ? t.uiDiffRemoveForeground : t.uiTextSecondary }]}
      >
        {text || ' '}
      </Text>
    </View>
  );
});

export function DiffView({ rows }: { rows: readonly DiffLine[] }) {
  const t = useTokens();
  const { texts, gutter, width } = useMemo(() => {
    const shown = rows.map((row) => displayLine(row.text));
    const gutterWidth = Math.max(36, Math.ceil(gutterDigits(rows) * CHAR) + 16);
    let longest = 0;
    for (const text of shown) if (text.length > longest) longest = text.length;
    return { texts: shown, gutter: gutterWidth, width: gutterWidth + 2 + 10 + Math.ceil(Math.min(longest, MAX_COLUMNS + 1) * CHAR) + 28 };
  }, [rows]);
  const runs = useMemo(() => overviewRuns(rows), [rows]);

  return (
    <View style={styles.fill}>
      <ScrollView horizontal nestedScrollEnabled contentContainerStyle={{ minWidth: '100%' }} style={styles.fill}>
        <FlatList
          style={{ width }}
          data={rows}
          keyExtractor={(_, index) => String(index)}
          getItemLayout={(_, index) => ({ length: LINE, offset: LINE * index, index })}
          initialNumToRender={40}
          maxToRenderPerBatch={40}
          windowSize={9}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item, index }) => <Row row={item} text={texts[index]} gutter={gutter} width={width} t={t} />}
        />
      </ScrollView>
      {runs.length ? (
        <View pointerEvents="none" style={[styles.ruler, { height: Math.min(rows.length * LINE, 100000) }]}>
          {runs.map((run, index) => (
            <View
              key={index}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${run.startPct}%`,
                height: `${run.sizePct}%`,
                minHeight: 2,
                backgroundColor: run.kind === 'add' ? t.uiDiffAddBorder : t.uiDiffRemoveBorder,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  ruler: { position: 'absolute', top: 0, right: 0, width: 6, maxHeight: '100%', opacity: 0.8 },
});
