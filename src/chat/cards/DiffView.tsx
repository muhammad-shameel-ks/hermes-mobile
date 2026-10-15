/**
 * A read-only unified diff, painted natively: monospace rows tinted by kind with
 * a 2px gutter accent, the desktop's add and remove tokens, no `+/-` gutter and
 * no hunk headers. Colour only - there is no highlighter on the phone. Long
 * lines scroll sideways as one block; a long diff folds to the desktop's 12rem
 * box and opens on demand rather than giving the transcript an inner scroller.
 */

import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MONO, useTokens } from '../../ui/tokens.ts';
import { parseDiff, type DiffKind } from '../diff.ts';
import { diffColors } from './diffColors.ts';

const FONT_SIZE = 11.2;
const LINE_HEIGHT = FONT_SIZE * 1.625;
const ROW_HEIGHT = LINE_HEIGHT + 2;
const FOLDED_HEIGHT = 192;
const FOLDED_ROWS = Math.floor(FOLDED_HEIGHT / ROW_HEIGHT);
/** a diff past this many rows stops rendering; the rest is a count */
const MAX_ROWS = 800;

function DiffViewImpl({ diff }: { diff: string }) {
  const t = useTokens();
  const colors = useMemo(() => diffColors(t.renderedMode), [t.renderedMode]);
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(0);

  const foldable = lines.length > FOLDED_ROWS;
  const shown = open ? lines.slice(0, MAX_ROWS) : foldable ? lines.slice(0, FOLDED_ROWS) : lines;
  const hidden = lines.length - shown.length;

  const tint = (kind: DiffKind) =>
    kind === 'add'
      ? { borderLeftColor: colors.addBorder, backgroundColor: colors.addBackground }
      : kind === 'remove'
        ? { borderLeftColor: colors.removeBorder, backgroundColor: colors.removeBackground }
        : { borderLeftColor: 'transparent' };
  const ink = (kind: DiffKind) => (kind === 'add' ? colors.addForeground : kind === 'remove' ? colors.removeForeground : t.uiTextSecondary);

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: width }}>
          {shown.map((line, index) => (
            <View key={index} style={[styles.row, tint(line.kind)]}>
              <Text style={[styles.text, { color: ink(line.kind) }]}>{line.text || ' '}</Text>
            </View>
          ))}
        </View>
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
