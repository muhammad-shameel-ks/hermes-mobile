/**
 * The room's member roster sheet, opened from the header's overflow menu: each bot's face, label and
 * handle.
 */
import { StyleSheet, Text, View } from 'react-native';

import type { Bot } from '../../bots/roster.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { useTokens } from '../../ui/tokens.ts';
import type { GroupMember } from '../rooms.ts';
import { MemberAvatar } from './MemberAvatar.tsx';

type Props = {
  visible: boolean;
  members: readonly GroupMember[];
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
  onClose: () => void;
};

export function MembersSheet({ visible, members, roster, loadImage, onClose }: Props) {
  const t = useTokens();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>Members</Text>
      </View>
      {members.map((member) => (
        <View key={member.memberId} style={styles.row}>
          <MemberAvatar profile={member.profile} label={member.label} size={32} roster={roster} loadImage={loadImage} />
          <View style={styles.text}>
            <Text numberOfLines={1} style={[styles.label, { color: t.uiTextPrimary }]}>
              {member.label}
            </Text>
            <Text numberOfLines={1} style={[styles.handle, { color: t.uiTextTertiary }]}>{`@${member.handle}`}</Text>
          </View>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 20 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: 15, fontWeight: '500' },
  handle: { fontSize: 12.5 },
});
