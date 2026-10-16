/**
 * The room's Activity panel (desktop `group-chat-view.tsx` `activityPanel`): a quiet disclosure above
 * the timeline, collapsed by default. Collapsed it names the latest turn outcome (or live work, or a
 * member left in failure); expanded it lists the current window newest-first. Never steals focus,
 * never auto-scrolls; opening it is always the reader's tap.
 */

import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { compactAge } from '../../bots/roster.ts';
import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens, type Tokens } from '../../ui/tokens.ts';
import { buildActivity, summarizeActivity, type ActivityRow } from '../activity.ts';
import type { GroupMember } from '../rooms.ts';
import type { RoomEvent } from '../../../vendor/hermes-shared/src/gateway-contract.generated.ts';

type Props = {
  events: readonly RoomEvent[];
  members: readonly GroupMember[];
  working: boolean;
  now: number;
};

const ROW_GLYPH = 12;

function toneColor(tone: ActivityRow['tone'], t: Tokens): string {
  if (tone === 'error') return t.dtDestructive;
  if (tone === 'work') return t.uiAccent;
  return t.uiTextTertiary;
}

function RoomActivityImpl({ events, members, working, now }: Props) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => buildActivity(events, members), [events, members]);
  const summary = useMemo(() => summarizeActivity(rows, working, now), [rows, working, now]);
  const shown = useMemo(() => [...rows].reverse(), [rows]);
  if (rows.length === 0 && !working) return null;

  const chevron = open ? 'chevron-down' : 'chevron-right';
  return (
    <View style={[styles.panel, { borderColor: t.uiStrokeSecondary }]}>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide room activity' : 'Show room activity'}
        hitSlop={8}
        style={styles.head}
      >
        <Codicon name={chevron} size={12} color={t.uiTextQuaternary} />
        <Text style={[styles.title, { color: t.uiTextQuaternary }]}>Activity</Text>
        {summary ? (
          <Text numberOfLines={1} style={[styles.summary, { color: t.uiTextTertiary }]}>
            {summary}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View>
          {shown.length ? (
            shown.map((row) => (
              <View key={row.key} style={styles.row}>
                <Codicon name={row.glyph} size={ROW_GLYPH} color={toneColor(row.tone, t)} />
                <Text numberOfLines={1} style={[styles.rowText, { color: toneColor(row.tone, t) }]}>
                  {row.text}
                </Text>
                <Text style={[styles.age, { color: t.uiTextQuaternary }]}>{compactAge(row.at, now) || 'now'}</Text>
              </View>
            ))
          ) : (
            <Text style={[styles.empty, { color: t.uiTextQuaternary }]}>No activity yet.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export const RoomActivity = memo(RoomActivityImpl);

const styles = StyleSheet.create({
  panel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  title: { fontSize: 12, fontWeight: '600' },
  summary: { flex: 1, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  rowText: { flex: 1, fontSize: 12, lineHeight: 16 },
  age: { fontSize: 11 },
  empty: { fontSize: 11, paddingBottom: 6 },
});
