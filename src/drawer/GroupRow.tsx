/**
 * One group chat row (apps/desktop/src/plugins/hermes-bots), matching BotRow's 60dp geometry and
 * typography: a 38dp 2x2 cluster of up to four members' faces in place of the single bot face, the
 * room's name, the compact age and the newest-message preview. Rows only: the pane decides what to
 * list. A long-press opens the action sheet in place of the context menu.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BotAvatar } from '../bots/BotAvatar.tsx';
import { compactAge, type Bot } from '../bots/roster.ts';
import type { GroupRow as GroupRowData } from '../groups/model.ts';
import type { GroupMember, GroupRoom } from '../groups/rooms.ts';
import { tick } from '../ui/haptics.ts';
import { useTokens } from '../ui/tokens.ts';

type Props = {
  row: GroupRowData;
  now: number;
  bots: Record<string, Bot>;
  onOpen: (room: GroupRoom) => void;
  onActions: (room: GroupRoom) => void;
  loadImage: (name: string) => Promise<string | null>;
};

const CLUSTER = 38;

/** where each face sits in the 38dp tile: two overlap on a diagonal, three form a triangle, four or more a 2x2 */
const LAYOUTS: Record<number, { size: number; spots: ReadonlyArray<{ left: number; top: number }> }> = {
  1: { size: 30, spots: [{ left: 4, top: 4 }] },
  2: { size: 24, spots: [{ left: 0, top: 0 }, { left: 14, top: 14 }] },
  3: { size: 19, spots: [{ left: 9.5, top: 0 }, { left: 0, top: 19 }, { left: 19, top: 19 }] },
  4: { size: 18, spots: [{ left: 0, top: 0 }, { left: 20, top: 0 }, { left: 0, top: 20 }, { left: 20, top: 20 }] },
};

/** one cluster cell: the roster's current face for the member's profile, else a plain initial tile */
function MemberFace({ member, bots, loadImage, size }: { member: GroupMember; bots: Record<string, Bot>; loadImage: (name: string) => Promise<string | null>; size: number }) {
  const t = useTokens();
  const bot = bots[member.profile];
  if (bot) return <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={size} loadImage={loadImage} />;
  const initial = (member.label || member.profile).trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.initial, { width: size, height: size, backgroundColor: t.uiBgTertiary, borderRadius: size * 0.22 }]}>
      <Text style={[styles.initialText, { color: t.uiTextSecondary }]}>{initial}</Text>
    </View>
  );
}

function GroupRowImpl({ row, now, bots, onOpen, onActions, loadImage }: Props) {
  const t = useTokens();
  const { room, preview } = row;
  const age = compactAge(room.updatedAt, now);
  const faces = room.members.slice(0, 4);
  const layout = LAYOUTS[Math.max(1, faces.length)];

  return (
    <Pressable
      onPress={() => onOpen(room)}
      onLongPress={() => {
        tick();
        onActions(room);
      }}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={[room.name, `${room.members.length} members`, age].filter(Boolean).join(', ')}
      accessibilityHint="Long press for more actions"
      style={({ pressed }) => [styles.row, { borderRadius: t.radius.md }, pressed && { backgroundColor: t.uiRowHoverBackground }]}
    >
      <View style={styles.cluster}>
        {faces.map((member, index) => (
          <View key={member.memberId} style={[styles.cell, layout.spots[index]]}>
            <MemberFace member={member} bots={bots} loadImage={loadImage} size={layout.size} />
          </View>
        ))}
      </View>
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={[styles.nameText, { color: t.dtForeground }]}>
            {room.name}
          </Text>
          {age ? <Text style={[styles.age, { color: t.uiTextQuaternary }]}>{age}</Text> : null}
        </View>
        {preview ? (
          <Text numberOfLines={1} style={[styles.preview, { color: t.uiTextTertiary }]}>
            {preview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const GroupRow = memo(
  GroupRowImpl,
  (a, b) =>
    a.row.room.id === b.row.room.id &&
    a.row.room.name === b.row.room.name &&
    a.row.room.updatedAt === b.row.room.updatedAt &&
    a.row.room.members === b.row.room.members &&
    a.row.preview === b.row.preview &&
    a.now === b.now &&
    a.bots === b.bots &&
    a.onOpen === b.onOpen &&
    a.onActions === b.onActions &&
    a.loadImage === b.loadImage,
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 10, minHeight: 60 },
  cluster: { width: CLUSTER, height: CLUSTER },
  cell: { position: 'absolute' },
  initial: { alignItems: 'center', justifyContent: 'center' },
  initialText: { fontSize: 9, fontWeight: '600' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 21, fontWeight: '500' },
  age: { fontSize: 12, lineHeight: 16 },
  preview: { fontSize: 14, lineHeight: 19 },
});
