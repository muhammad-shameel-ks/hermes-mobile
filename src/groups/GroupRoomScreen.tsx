/**
 * The room screen: a pushed full-screen overlay (ADR 0003) showing one
 * gateway-hosted room - its header, timeline, pending actions and composer. `useRoom` drives every bit of
 * state; this screen only arranges it, so a poll tick touches the header (member list, driver status) and
 * leaves typing in the composer alone.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardPaddedView } from '../ui/KeyboardPaddedView.tsx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Bot } from '../bots/roster.ts';
import type { ChatController, ChatSnapshot } from '../chat/controller.ts';
import { shallowEqual } from '../chat/selector.ts';
import { useChatSelector } from '../chat/useChatSelector.ts';
import { ActionButton } from '../settings/primitives.tsx';
import { ActionSheet, Sheet, type SheetAction } from '../ui/Sheet.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../ui/tokens.ts';
import { useRoom } from './hooks.ts';
import type { GroupsModel } from './model.ts';
import { MAX_GROUP_NAME, type PendingAction } from './rooms.ts';
import { MembersSheet } from './room/MembersSheet.tsx';
import { RoomActivity } from './room/RoomActivity.tsx';
import { RoomComposer } from './room/RoomComposer.tsx';
import { RoomHeader } from './room/RoomHeader.tsx';
import { RoomTimeline } from './room/RoomTimeline.tsx';
import { useStableMembers, useStablePendingActions } from './room/stableRoom.ts';

// desktop i18n.ts group.disbandDescPrefix / disbandDescSuffix
const DISBAND_PREFIX = 'This removes the ';
const disbandSuffix = (count: number) =>
  ` grouping from its ${count} bots and clears the shared room log. The bots themselves and their per-group sessions are kept.`;

const selectRoster = (snapshot: ChatSnapshot) => snapshot.roster;

type Props = {
  controller: ChatController;
  model: GroupsModel;
  roomId: string;
  name: string;
  onClose: () => void;
};

export default function GroupRoomScreen({ controller, model, roomId, name, onClose }: Props) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { store, room } = useRoom(model, roomId);
  const roster = useChatSelector(controller, selectRoster, shallowEqual);
  const rosterByProfile = useMemo(() => {
    const map: Record<string, Bot> = {};
    for (const bot of roster.visible) map[bot.name] = bot;
    for (const bot of roster.hidden) map[bot.name] = bot;
    return map;
  }, [roster]);

  const members = useStableMembers(room.room?.members);
  const pending = useStablePendingActions(room.driver);
  const title = room.room?.name ?? name;

  const [membersOpen, setMembersOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const openMembers = useCallback(() => setMembersOpen(true), []);
  const closeMembers = useCallback(() => setMembersOpen(false), []);
  const openRename = useCallback(() => setRenaming(true), []);
  const closeRename = useCallback(() => setRenaming(false), []);
  const openOverflow = useCallback(() => setOverflowOpen(true), []);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);

  const onStop = useCallback(() => void store.stopRun(), [store]);
  const onLoadEarlier = useCallback(() => void store.loadEarlier(), [store]);
  const [pulling, setPulling] = useState(false);
  const onPull = useCallback(() => {
    setPulling(true);
    void store.refresh().finally(() => setPulling(false));
  }, [store]);
  const onSend = useCallback((text: string) => store.send(text), [store]);
  const onRetryUnsent = useCallback(() => void store.retryUnsent(), [store]);
  const onApprove = useCallback(
    (action: Extract<PendingAction, { kind: 'approval' }>, choice: 'once' | 'deny') =>
      void store.approve({ memberId: action.memberId, taskId: action.taskId, generation: action.generation, requestId: action.requestId }, choice),
    [store],
  );
  const onRetryTask = useCallback((taskId: string) => void store.retryTask(taskId), [store]);

  const confirmDisband = useCallback(() => {
    Alert.alert('Disband group chat?', `${DISBAND_PREFIX}${title}${disbandSuffix(members.length)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disband',
        style: 'destructive',
        onPress: () => {
          void store.disband().then((ok) => {
            if (ok) onClose();
          });
        },
      },
    ]);
  }, [store, title, members.length, onClose]);

  const overflowActions = useMemo<SheetAction[]>(
    () => [
      { label: 'Members', onPress: openMembers },
      { label: 'Rename…', onPress: openRename },
      { label: 'Disband', destructive: true, onPress: confirmDisband },
    ],
    [openMembers, openRename, confirmDisband],
  );

  const submitRename = useCallback(
    (value: string) => {
      closeRename();
      void store.rename(value);
    },
    [store, closeRename],
  );

  let body: ReactNode;
  if (room.phase === 'loading') {
    body = (
      <View style={styles.center}>
        <GlyphSpinner size={20} color={t.uiTextTertiary} />
      </View>
    );
  } else if (room.phase === 'error') {
    body = (
      <View style={styles.center}>
        <Text style={[styles.stateTitle, { color: t.dtDestructive }]}>Could not load this group chat.</Text>
        {room.readError ? <Text style={[styles.stateDetail, { color: t.uiTextTertiary }]}>{room.readError}</Text> : null}
        <Pressable
          onPress={() => void store.refresh()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['2xl'] }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ color: t.uiTextSecondary, fontSize: 14, fontWeight: '500' }}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (room.phase === 'gone') {
    body = (
      <View style={styles.center}>
        <Text style={[styles.stateTitle, { color: t.uiTextPrimary }]}>This group chat was disbanded.</Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['2xl'] }, pressed && { opacity: 0.7 }]}
        >
          <Text style={{ color: t.uiTextSecondary, fontSize: 14, fontWeight: '500' }}>Back</Text>
        </Pressable>
      </View>
    );
  } else {
    const driverMissing = room.driver === null;
    body = (
      <View style={styles.flex}>
        {room.readError ? (
          <View style={[styles.banner, { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius['2xl'] }]} accessibilityLiveRegion="polite">
            <GlyphSpinner size={12} color={t.uiTextTertiary} />
            <Text style={{ flex: 1, color: t.uiTextTertiary, fontSize: 13, lineHeight: 18 }}>
              {'Could not refresh this group chat. Retrying…'}
              <Text style={{ color: t.uiTextQuaternary }}>{` ${room.readError}`}</Text>
            </Text>
          </View>
        ) : null}
        {driverMissing ? (
          <View style={[styles.banner, { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius['2xl'] }]}>
            <Text style={{ flex: 1, color: t.uiTextTertiary, fontSize: 13, lineHeight: 18 }}>Group driver unavailable. Update or reconnect the owning gateway.</Text>
          </View>
        ) : null}
        <RoomActivity events={room.events} members={members} working={room.driver?.working ?? false} now={Math.floor(Date.now() / 1000)} />
        <RoomTimeline
          events={room.events}
          members={members}
          roster={rosterByProfile}
          loadImage={controller.avatarDataFn}
          more={room.more}
          loadingEarlier={room.loadingEarlier}
          onLoadEarlier={onLoadEarlier}
          refreshing={pulling}
          onRefresh={onPull}
          pending={pending}
          busy={room.busy}
          onApprove={onApprove}
          onRetryTask={onRetryTask}
          working={room.driver?.working ?? false}
        />
        {room.actionError ? (
          <View style={styles.actionError} accessibilityLiveRegion="polite">
            <Text style={[styles.actionErrorText, { color: t.dtDestructive }]}>{room.actionError}</Text>
          </View>
        ) : null}
        <RoomComposer
          members={members}
          roster={rosterByProfile}
          loadImage={controller.avatarDataFn}
          ready
          driverMissing={driverMissing}
          sending={room.sending}
          unsent={room.unsent}
          onSend={onSend}
          onRetryUnsent={onRetryUnsent}
        />
      </View>
    );
  }

  return (
    <KeyboardPaddedView style={[styles.root, { backgroundColor: t.uiChatSurfaceBackground }]}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <RoomHeader
          title={title}
          members={members}
          roster={rosterByProfile}
          loadImage={controller.avatarDataFn}
          stopEnabled={room.driver?.working ?? false}
          onBack={onClose}
          onStop={onStop}
          onOverflow={openOverflow}
        />
        {body}

        <ActionSheet visible={overflowOpen} actions={overflowActions} onClose={closeOverflow} />
        <MembersSheet visible={membersOpen} members={members} roster={rosterByProfile} loadImage={controller.avatarDataFn} onClose={closeMembers} />
        <RenameSheet visible={renaming} initial={title} busy={room.busy} onClose={closeRename} onSubmit={submitRename} />
      </View>
    </KeyboardPaddedView>
  );
}

function RenameSheet({
  visible,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useTokens();
  const [value, setValue] = useState(initial);
  const wasVisible = useRef(false);
  if (visible && !wasVisible.current) setValue(initial);
  wasVisible.current = visible;

  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose}>
      <View style={styles.renameForm}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>Rename group chat</Text>
        <TextInput
          autoFocus
          selectTextOnFocus
          editable={!busy}
          value={value}
          onChangeText={setValue}
          maxLength={MAX_GROUP_NAME}
          onSubmitEditing={submit}
          returnKeyType="done"
          placeholderTextColor={t.uiTextQuaternary}
          accessibilityLabel="Group name"
          style={[styles.renameInput, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
        />
        <View style={styles.renameButtons}>
          <ActionButton label="Cancel" variant="ghost" disabled={busy} onPress={onClose} />
          <ActionButton label="Save" busy={busy} disabled={!trimmed} onPress={submit} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  stateTitle: { fontSize: 16, fontWeight: '500', textAlign: 'center' },
  stateDetail: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, marginTop: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8 },
  actionError: { paddingHorizontal: 20, paddingTop: 6 },
  actionErrorText: { fontSize: 13, lineHeight: 18 },
  renameForm: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 4 },
  renameInput: { fontSize: 15, paddingHorizontal: 12, minHeight: 44, marginTop: 8 },
  renameButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
});
