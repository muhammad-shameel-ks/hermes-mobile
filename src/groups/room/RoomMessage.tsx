/**
 * One timeline row: the reader's right-aligned bubble, a member's left-aligned turn (avatar and speaker
 * label dropped for a run of consecutive messages from the same bot), or a centred system note. Wrapped
 * in `memo` with a value comparator because `buildTimeline` has no per-row cache of its own: whenever a
 * new event arrives it rebuilds every row fresh, so comparing by content (not by the row object's
 * identity) is what keeps an unaffected row from re-rendering.
 */
import { memo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import type { Bot } from '../../bots/roster.ts';
import { Markdown } from '../../chat/Markdown.tsx';
import { shallowEqualArray } from '../../chat/selector.ts';
import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens, type Tokens } from '../../ui/tokens.ts';
import { splitMentions, type GroupMember, type TimelineRow } from '../rooms.ts';
import { MemberAvatar } from './MemberAvatar.tsx';

/** the app's side rhythm (ChatScreen/TranscriptPane `SIDE_INSET`), duplicated rather than imported so a
 * group room never pulls assistant-ui in through TranscriptPane's module */
const SIDE_INSET = 24;
const AVATAR = 30;

/** `at` is epoch seconds, as every other timestamp in this codebase is */
function timeLabel(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const date = new Date(at * 1000);
  try {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}

function FileChip({ name, t }: { name: string; t: Tokens }) {
  return (
    <View style={styles.file}>
      <Codicon name="file" size={13} color={t.uiTextTertiary} />
      <Text numberOfLines={1} style={[styles.fileName, { color: t.uiTextTertiary }]}>
        {name}
      </Text>
    </View>
  );
}

function MentionText({
  text,
  members,
  color,
  mentionColor,
  style,
}: {
  text: string;
  members: readonly GroupMember[];
  color: string;
  mentionColor: string;
  style: TextStyle;
}) {
  const segments = splitMentions(text, members);
  return (
    <Text selectable style={[style, { color }]}>
      {segments.map((segment, index) =>
        segment.mention ? (
          <Text key={index} style={{ color: mentionColor, fontWeight: '600' }}>
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

function UserRow({ row, members, t }: { row: Extract<TimelineRow, { kind: 'user' }>; members: readonly GroupMember[]; t: Tokens }) {
  return (
    <View style={styles.userRow}>
      <View style={[styles.bubble, { backgroundColor: t.uiChatBubbleBackground, borderRadius: t.radius['3xl'] }]}>
        {row.text ? (
          <MentionText text={row.text} members={members} color={t.uiTextPrimary} mentionColor={t.uiAccent} style={{ fontSize: t.type.text, lineHeight: t.type.lineHeight }} />
        ) : null}
        {row.files.length > 0 ? (
          <View style={styles.files}>
            {row.files.map((name) => (
              <FileChip key={name} name={name} t={t} />
            ))}
          </View>
        ) : null}
      </View>
      <Text style={[styles.time, styles.timeRight, { color: t.uiTextQuaternary }]}>{timeLabel(row.at)}</Text>
    </View>
  );
}

function MemberRow({
  row,
  continued,
  roster,
  loadImage,
  t,
}: {
  row: Extract<TimelineRow, { kind: 'member' }>;
  continued: boolean;
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
  t: Tokens;
}) {
  const label = row.member?.label ?? row.speaker;
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberLead}>{!continued ? <MemberAvatar profile={row.member?.profile ?? ''} label={label} size={AVATAR} roster={roster} loadImage={loadImage} /> : null}</View>
      <View style={styles.memberBody}>
        {!continued ? (
          <View style={styles.memberHeader}>
            <Text numberOfLines={1} style={[styles.speaker, { color: t.uiTextSecondary }]}>
              {label}
            </Text>
            <Text style={[styles.time, { color: t.uiTextQuaternary }]}>{timeLabel(row.at)}</Text>
          </View>
        ) : null}
        {row.text ? <Markdown text={row.text} /> : null}
        {row.files.length > 0 ? (
          <View style={styles.files}>
            {row.files.map((name) => (
              <FileChip key={name} name={name} t={t} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function NoteRow({ row, t }: { row: Extract<TimelineRow, { kind: 'note' }>; t: Tokens }) {
  const color = row.tone === 'error' ? t.dtDestructive : t.uiTextTertiary;
  return (
    <View style={styles.noteRow}>
      <Text style={[styles.noteText, { color }]}>{row.text}</Text>
    </View>
  );
}

type Props = {
  row: TimelineRow;
  continued: boolean;
  members: readonly GroupMember[];
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
};

function RoomMessageRowImpl({ row, continued, members, roster, loadImage }: Props) {
  const t = useTokens();
  return (
    <View style={styles.row}>
      {row.kind === 'note' ? (
        <NoteRow row={row} t={t} />
      ) : row.kind === 'user' ? (
        <UserRow row={row} members={members} t={t} />
      ) : (
        <MemberRow row={row} continued={continued} roster={roster} loadImage={loadImage} t={t} />
      )}
    </View>
  );
}

function sameRow(a: Props, b: Props): boolean {
  if (a.roster !== b.roster || a.loadImage !== b.loadImage || a.members !== b.members || a.continued !== b.continued) return false;
  const x = a.row;
  const y = b.row;
  if (x === y) return true;
  if (x.kind !== y.kind || x.key !== y.key) return false;
  if (x.kind === 'note' && y.kind === 'note') return x.tone === y.tone && x.text === y.text;
  if (x.kind === 'user' && y.kind === 'user') return x.text === y.text && shallowEqualArray(x.files, y.files);
  if (x.kind === 'member' && y.kind === 'member') return x.text === y.text && x.speaker === y.speaker && x.member === y.member && shallowEqualArray(x.files, y.files);
  return false;
}

export const RoomMessageRow = memo(RoomMessageRowImpl, sameRow);

const styles = StyleSheet.create({
  row: { paddingHorizontal: SIDE_INSET, paddingVertical: 3 },
  userRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 9, gap: 6 },
  files: { gap: 4, marginTop: 4 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fileName: { fontSize: 12, flexShrink: 1 },
  time: { fontSize: 10.5 },
  timeRight: { marginTop: 3, marginRight: 2 },
  memberRow: { flexDirection: 'row' },
  memberLead: { width: AVATAR, alignItems: 'center' },
  memberBody: { flex: 1, minWidth: 0, marginLeft: 8, gap: 2 },
  memberHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 1 },
  speaker: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  noteRow: { alignItems: 'center', paddingVertical: 4 },
  noteText: { fontSize: 12.5, lineHeight: 17, textAlign: 'center' },
});
