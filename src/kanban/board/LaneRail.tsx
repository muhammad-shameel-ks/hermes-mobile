/**
 * The board's lane strip, the phone's view of the desktop's row of columns. The pipeline ribbon on top
 * shows each lane's share of the board in its tone, so the whole flow reads at a glance; the chips below
 * name each lane with its count and switch the page. An empty lane's chip is dimmed, as the desktop folds
 * an empty column to a rail (on a board with no work at all, nothing dims).
 */

import { memo, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mixPct } from '../../ui/color.ts';
import { tick } from '../../ui/haptics.ts';
import { useTokens } from '../../ui/tokens.ts';
import { laneTone, type FlowSegment } from '../model.ts';
import { laneLabel } from '../text.ts';

const RIBBON_H = 4;

export const LaneRail = memo(function LaneRail({ segments, active, onSelect }: { segments: readonly FlowSegment[]; active: number; onSelect: (index: number) => void }) {
  const t = useTokens();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const boardHasWork = segments.some((s) => s.count > 0);

  // keep the active chip in view as pages are swiped
  useEffect(() => {
    const x = offsets.current[active];
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [active]);

  return (
    <View style={[styles.root, { borderBottomColor: t.uiStrokeQuaternary }]}>
      <View style={[styles.ribbon, { backgroundColor: t.uiBgQuaternary }]} accessible={false}>
        {segments.map((segment, index) =>
          segment.count > 0 ? (
            <View
              key={segment.name}
              style={{ flex: segment.count, backgroundColor: laneTone(segment.name, t), opacity: index === active ? 1 : 0.45 }}
            />
          ) : null,
        )}
      </View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        {segments.map((segment, index) => {
          const selected = index === active;
          const tone = laneTone(segment.name, t);
          const dim = boardHasWork && segment.count === 0 && !selected;
          return (
            <Pressable
              key={segment.name}
              onLayout={(event) => {
                offsets.current[index] = event.nativeEvent.layout.x;
              }}
              onPress={() => {
                if (selected) return;
                tick();
                onSelect(index);
              }}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${laneLabel(segment.name)}, ${segment.count}`}
              style={[
                styles.chip,
                { borderRadius: t.radius.full, backgroundColor: selected ? mixPct(tone, 0.16, 'transparent') : 'transparent', opacity: dim ? 0.5 : 1 },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: tone }]} />
              <Text style={[styles.label, { color: selected ? tone : t.uiTextTertiary }]}>{laneLabel(segment.name)}</Text>
              {segment.count > 0 ? <Text style={[styles.count, { color: selected ? tone : t.uiTextQuaternary }]}>{segment.count}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { borderBottomWidth: StyleSheet.hairlineWidth },
  ribbon: { flexDirection: 'row', height: RIBBON_H, marginHorizontal: 16, marginTop: 4, borderRadius: RIBBON_H / 2, overflow: 'hidden', gap: 1 },
  chips: { paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  count: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
