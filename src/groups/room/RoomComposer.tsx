/**
 * The room's composer: a multiline input, the '@' mention trigger and its suggestion panel, the send
 * button, and the unsent-send banner. The draft lives in this component's own state - never lifted to
 * GroupRoomScreen - so typing never re-renders the timeline above it.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Bot } from '../../bots/roster.ts';
import { useKeyboardOpen } from '../../chat/useKeyboardOpen.ts';
import { Codicon } from '../../ui/Codicon.tsx';
import { GlyphSpinner } from '../../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { completeMention, mentionAtEnd, mentionOptions, type GroupMember, type MentionOption } from '../rooms.ts';
import type { SendOutcome, Unsent } from '../roomStore.ts';
import { MemberAvatar } from './MemberAvatar.tsx';

const EMPTY_OPTIONS: readonly MentionOption[] = [];

type Props = {
  members: readonly GroupMember[];
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
  ready: boolean;
  driverMissing: boolean;
  sending: boolean;
  unsent: Unsent | null;
  onSend: (text: string) => Promise<SendOutcome>;
  onRetryUnsent: () => void;
};

function RoomComposerImpl({ members, roster, loadImage, ready, driverMissing, sending, unsent, onSend, onRetryUnsent }: Props) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardOpen();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);
  // leaving the room unmounts a focused input; Android would keep the keyboard up over the screen behind
  useEffect(() => () => Keyboard.dismiss(), []);

  const mention = mentionAtEnd(draft);
  const query = mention?.query ?? null;
  const options = useMemo(() => (query === null ? EMPTY_OPTIONS : mentionOptions(members, query)), [query, members]);

  const pick = useCallback((handle: string) => {
    setDraft((prev) => completeMention(prev, handle));
    inputRef.current?.focus();
  }, []);

  const appendMention = useCallback(() => {
    setDraft((prev) => (prev === '' || /\s$/.test(prev) ? `${prev}@` : `${prev} @`));
    inputRef.current?.focus();
  }, []);

  const hasUnsent = unsent !== null;
  const canSend = !hasUnsent && !sending && ready && !driverMissing && draft.trim() !== '';

  const submit = useCallback(() => {
    if (!canSend) return;
    const text = draft;
    void onSend(text).then((outcome) => {
      if (outcome === 'sent' || outcome === 'unconfirmed') setDraft('');
    });
  }, [canSend, draft, onSend]);

  return (
    <View style={[styles.dock, { paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 8) }]}>
      {query !== null ? <MentionPanel options={options} members={members} roster={roster} loadImage={loadImage} onPick={pick} /> : null}

      {unsent ? (
        <View style={[styles.unsent, { backgroundColor: t.uiBgSecondary, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.lg }]}>
          <View style={styles.unsentBody}>
            <Text style={[styles.unsentTitle, { color: t.uiTextSecondary }]}>Your last message is not confirmed. Retrying sends it exactly once.</Text>
            <Text numberOfLines={3} style={[styles.unsentQuote, { color: t.uiTextTertiary }]}>
              {unsent.text}
            </Text>
          </View>
          <Pressable onPress={onRetryUnsent} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.unsentRetry, { color: t.uiAccent }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.composer, { backgroundColor: t.uiBgEditor, borderColor: t.uiComposerBorder, borderRadius: t.radius['2xl'] }]}>
        <View style={styles.inputCell}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            editable={!hasUnsent}
            multiline
            style={[styles.input, { color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.text * 1.5 }]}
            selectionColor={t.uiAccent}
            accessibilityLabel="Message"
            accessibilityHint="Say something. Every bot in this group hears the room."
          />
          {draft === '' ? (
            <Text
              pointerEvents="none"
              numberOfLines={1}
              accessible={false}
              style={[styles.placeholder, { color: t.uiTextTertiary, fontSize: t.type.text, lineHeight: t.type.text * 1.5 }]}
            >
              Say something. Every bot in this group hears the room.
            </Text>
          ) : null}
        </View>
        <View style={styles.row}>
          <Pressable
            onPress={appendMention}
            disabled={hasUnsent}
            accessibilityRole="button"
            accessibilityLabel="Mention a bot"
            hitSlop={4}
            style={({ pressed }) => [styles.ghostButton, { borderRadius: t.radius.full }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
          >
            <Text style={[styles.at, { color: t.uiTextSecondary }]}>@</Text>
          </Pressable>
          <View style={styles.spacer} />
          <Pressable
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={6}
            style={({ pressed }) => [styles.sendButton, { backgroundColor: canSend ? t.dtPrimarySolid : t.uiBgTertiary }, pressed && canSend && { opacity: 0.85 }]}
          >
            {sending ? (
              <GlyphSpinner size={14} color={canSend ? t.dtPrimarySolidForeground : t.uiTextTertiary} />
            ) : (
              <Codicon name="arrow-up" size={16} color={canSend ? t.dtPrimarySolidForeground : t.uiTextTertiary} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MentionPanel({
  options,
  members,
  roster,
  loadImage,
  onPick,
}: {
  options: readonly MentionOption[];
  members: readonly GroupMember[];
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
  onPick: (handle: string) => void;
}) {
  const t = useTokens();
  return (
    <View style={[styles.panel, { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.lg }]}>
      {options.length === 0 ? (
        <Text style={[styles.panelEmpty, { color: t.uiTextTertiary }]}>No matching bots</Text>
      ) : (
        <ScrollView keyboardShouldPersistTaps="always" style={styles.panelScroll}>
          {options.map((option) => {
            const member = members.find((candidate) => candidate.handle === option.handle);
            return (
              <Pressable
                key={option.handle}
                onPress={() => onPick(option.handle)}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${option.label}`}
                style={({ pressed }) => [styles.panelRow, pressed && { backgroundColor: t.uiControlActiveBackground }]}
              >
                {member ? (
                  <MemberAvatar profile={member.profile} label={option.label} size={24} roster={roster} loadImage={loadImage} />
                ) : (
                  <View style={[styles.everyone, { backgroundColor: t.uiBgTertiary }]}>
                    <Codicon name="account" size={13} color={t.uiTextSecondary} />
                  </View>
                )}
                <View style={styles.panelText}>
                  <Text style={[styles.panelHandle, { color: t.uiTextPrimary }]}>{`@${option.handle}`}</Text>
                  <Text numberOfLines={1} style={[styles.panelLabel, { color: t.uiTextTertiary }]}>
                    {option.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

export const RoomComposer = memo(RoomComposerImpl);

const styles = StyleSheet.create({
  dock: { paddingHorizontal: 12, paddingTop: 6 },
  composer: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  inputCell: { justifyContent: 'center', paddingHorizontal: 6 },
  placeholder: { position: 'absolute', top: 8, left: 6, right: 6 },
  input: { minHeight: 40, maxHeight: 140, paddingTop: 8, paddingBottom: 8, paddingLeft: 0, paddingRight: 0, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  spacer: { flex: 1 },
  ghostButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  at: { fontSize: 17, fontWeight: '600' },
  sendButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  unsent: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  unsentBody: { flex: 1, gap: 2 },
  unsentTitle: { fontSize: 12.5, lineHeight: 17 },
  unsentQuote: { fontSize: 12, lineHeight: 16, fontStyle: 'italic' },
  unsentRetry: { fontSize: 13, fontWeight: '600' },
  panel: { borderWidth: StyleSheet.hairlineWidth, maxHeight: 220, marginBottom: 6, overflow: 'hidden' },
  panelScroll: { flexGrow: 0 },
  panelEmpty: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 14, textAlign: 'center' },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10 },
  everyone: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  panelText: { flex: 1, minWidth: 0 },
  panelHandle: { fontSize: 13.5, fontWeight: '600' },
  panelLabel: { fontSize: 11.5 },
});
