/**
 * A read-only unified diff, painted natively: monospace rows tinted by kind with
 * a 2px gutter accent, the desktop's add and remove tokens, no `+/-` gutter and
 * no hunk headers. Colour only - there is no highlighter on the phone. Long
 * lines scroll sideways as one block; a long diff folds to the desktop's 12rem
 * box and opens on demand rather than giving the transcript an inner scroller.
 */

import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { MONO, useTokens } from '../../ui/tokens.ts';
import { inlineDiffRows, type DiffKind } from '../../review/diff.ts';

const FONT_SIZE = 11.2;
const LINE_HEIGHT = FONT_SIZE * 1.625;
const ROW_HEIGHT = LINE_HEIGHT + 2;
const FOLDED_HEIGHT = 192;
const FOLDED_ROWS = Math.floor(FOLDED_HEIGHT / ROW_HEIGHT);
/** a diff past this many rows stops rendering; the rest is a count */
const MAX_ROWS = 800;

function DiffViewImpl({ diff }: { diff: string }) {
  const t = useTokens();
  const lines = useMemo(() => inlineDiffRows(diff), [diff]);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(0);

  const foldable = lines.length > FOLDED_ROWS;
  const count = open ? Math.min(lines.length, MAX_ROWS) : foldable ? FOLDED_ROWS : lines.length;
  const hidden = lines.length - count;

  // The row elements are built once per (diff, fold state, theme): the width measurement and every
  // other re-render hands React the same element objects, which it skips instead of diffing up to
  // MAX_ROWS rows.
  const rows = useMemo(() => {
    const tint = {
      add: [styles.row, { borderLeftColor: t.uiDiffAddBorder, backgroundColor: t.uiDiffAddBackground }],
      remove: [styles.row, { borderLeftColor: t.uiDiffRemoveBorder, backgroundColor: t.uiDiffRemoveBackground }],
      context: [styles.row, { borderLeftColor: 'transparent' }],
    } satisfies Record<DiffKind, unknown>;
    const ink = {
      add: [styles.text, { color: t.uiDiffAddForeground }],
      remove: [styles.text, { color: t.uiDiffRemoveForeground }],
      context: [styles.text, { color: t.uiTextSecondary }],
    } satisfies Record<DiffKind, unknown>;
    return lines.slice(0, count).map((line, index) => (
      <View key={index} style={tint[line.kind]}>
        <Text style={ink[line.kind]}>{line.text || ' '}</Text>
      </View>
    ));
  }, [lines, count, t]);

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: width }}>{rows}</View>
      </ScrollView>
      {foldable ? (
        <Pressable
          onPress={() => setOpen((value) => !value)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Fold diff' : 'Show the whole diff'}
          style={styles.more}
        >
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.tool }}>
            {open ? (hidden > 0 ? `Fold · ${hidden} more lines not shown` : 'Fold') : `Show ${hidden} more lines`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const DiffView = memo(DiffViewImpl);

const styles = StyleSheet.create({
  row: { borderLeftWidth: 2, paddingHorizontal: 10, paddingVertical: 1 },
  text: { fontFamily: MONO, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT },
  more: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6 },
});
