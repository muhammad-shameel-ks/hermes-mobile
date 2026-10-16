/**
 * The room's app bar: back, an overlapping face stack of its members, the room name with its member-count
 * caption, then Stop and the overflow menu. Mirrors ChatScreen's AppBar (avatar beside the title, a
 * subtitle under it) since OverlayScreen's one-line title has no room for the caption or the stack.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Bot } from '../../bots/roster.ts';
import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens } from '../../ui/tokens.ts';
import type { GroupMember } from '../rooms.ts';
import { MemberAvatar } from './MemberAvatar.tsx';

const FACE_SIZE = 24;
const FACE_OVERLAP = 8;
const MAX_FACES = 3;

type Props = {
  title: string;
  members: readonly GroupMember[];
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
  stopEnabled: boolean;
  onBack: () => void;
  onStop: () => void;
  onOverflow: () => void;
};

function RoomHeaderImpl({ title, members, roster, loadImage, stopEnabled, onBack, onStop, onOverflow }: Props) {
  const t = useTokens();
  const shown = members.slice(0, MAX_FACES);
  const extra = members.length - shown.length;

  return (
    <View style={[styles.header, { borderBottomColor: t.uiStrokeSecondary }]}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.edge}>
        <Codicon name="chevron-left" size={18} color={t.uiTextPrimary} />
      </Pressable>

      <View style={styles.titleBlock}>
        <View style={styles.titleLine}>
          {shown.length > 0 ? (
            <View style={styles.stack}>
              {shown.map((member, index) => (
                <View
                  key={member.memberId}
                  style={[styles.face, { marginLeft: index === 0 ? 0 : -FACE_OVERLAP, zIndex: shown.length - index, borderColor: t.uiChatSurfaceBackground }]}
                >
                  <MemberAvatar profile={member.profile} label={member.label} size={FACE_SIZE} roster={roster} loadImage={loadImage} />
                </View>
              ))}
              {extra > 0 ? (
                <View style={[styles.face, styles.more, { marginLeft: -FACE_OVERLAP, backgroundColor: t.uiBgTertiary, borderColor: t.uiChatSurfaceBackground }]}>
                  <Text style={[styles.moreText, { color: t.uiTextSecondary }]}>{`+${extra}`}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Text numberOfLines={1} style={[styles.title, { color: t.uiTextPrimary }]} accessibilityRole="header">
            {title}
          </Text>
        </View>
        {/* desktop i18n.ts group.memberCount */}
        {members.length > 0 ? <Text style={[styles.caption, { color: t.uiTextTertiary }]}>{`${members.length} bots`}</Text> : null}
      </View>

      <View style={styles.trailing}>
        <Pressable
          onPress={onStop}
          disabled={!stopEnabled}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Stop"
          accessibilityState={{ disabled: !stopEnabled }}
          style={[styles.edge, !stopEnabled && styles.disabled]}
        >
          <View style={[styles.stopGlyph, { backgroundColor: t.uiTextPrimary }]} />
        </Pressable>
        <Pressable onPress={onOverflow} hitSlop={10} accessibilityRole="button" accessibilityLabel="Group actions" style={styles.edge}>
          <Codicon name="kebab-vertical" size={18} color={t.uiTextPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

export const RoomHeader = memo(RoomHeaderImpl);

const styles = StyleSheet.create({
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  edge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 2, gap: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  stack: { flexDirection: 'row', alignItems: 'center' },
  face: { width: FACE_SIZE, height: FACE_SIZE, borderRadius: FACE_SIZE * 0.3, borderWidth: 1.5, overflow: 'hidden' },
  more: { alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 10, fontWeight: '700' },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 14 },
  trailing: { flexDirection: 'row', alignItems: 'center' },
  stopGlyph: { width: 11, height: 11, borderRadius: 2.5 },
});
