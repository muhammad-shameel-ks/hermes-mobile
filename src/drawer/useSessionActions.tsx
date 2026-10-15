/**
 * Long-press actions on a SESSIONS row (issue "App shell and navigation on a
 * phone": row gestures move to long-press): pin, rename, archive, delete. An
 * action sheet picks the verb, a form sheet renames, and delete is confirmed.
 * Copy is the desktop's `sidebar.row` and `sessions` strings.
 */

import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ChatController, SessionInfo } from '../chat/controller.ts';
import { errorText } from '../gateway/http.ts';
import { ActionButton } from '../settings/primitives.tsx';
import { ActionSheet, Sheet, type SheetAction } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { createSessionActions, deleteSessionDescription, isGatewayOwnedProfile } from './session-actions.ts';

// the vendored mutation client mints request ids with `crypto.randomUUID`, which React Native lacks;
// getRandomValues rides along so nothing that feature-detects `crypto` finds half of it
const scope = globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: unknown } };
if (typeof scope.crypto?.randomUUID !== 'function') {
  const missing = { randomUUID: Crypto.randomUUID, ...(typeof scope.crypto?.getRandomValues === 'function' ? {} : { getRandomValues: Crypto.getRandomValues }) };
  scope.crypto = Object.assign(scope.crypto ?? {}, missing);
}

const COPY = {
  pin: 'Pin',
  unpin: 'Unpin',
  rename: 'Rename…',
  archive: 'Archive',
  delete: 'Delete',
  cancel: 'Cancel',
  save: 'Save',
  renameTitle: 'Rename session',
  renameDesc: 'Leave empty to clear.',
  untitled: 'Untitled session',
  renamed: 'Renamed',
  renameFailed: 'Rename failed',
  archived: 'Archived',
  archiveFailed: 'Archive failed',
  deleteTitle: 'Delete session?',
  deleted: 'Session deleted',
  deleteFailed: 'Delete failed',
  pinFailed: 'Could not update the pin',
  gatewayOwned: 'Hermes does not allow editing sessions from an app while its gateway is running. Stop the gateway on the server to use this until Hermes supports it.',
};

const sessionTitle = (session: SessionInfo) => session.title || session.preview || COPY.untitled;

export function useSessionActions(controller: ChatController) {
  const [target, setTarget] = useState<SessionInfo | null>(null);
  const [renaming, setRenaming] = useState<SessionInfo | null>(null);
  const actions = useMemo(() => createSessionActions(controller.api), [controller]);

  const run = async (work: () => Promise<unknown>, done: string | null, failed: string) => {
    try {
      await work();
      if (done) controller.notify(done);
    } catch (error) {
      controller.notify(`${failed}. ${isGatewayOwnedProfile(error) ? COPY.gatewayOwned : errorText(error)}`);
    }
    void controller.refreshSessions();
  };

  /** the open chat leaves with its session: back to a fresh draft, as the desktop does */
  const leaveIfOpen = (session: SessionInfo) => {
    if (controller.getSnapshot().openKey === session.id) controller.newChat();
  };

  const sheetActions = (session: SessionInfo): SheetAction[] => [
    { label: session.pinned ? COPY.unpin : COPY.pin, onPress: () => void run(() => actions.setPinned(session.id, !session.pinned, session.profile), null, COPY.pinFailed) },
    { label: COPY.rename, onPress: () => setRenaming(session) },
    {
      label: COPY.archive,
      onPress: () =>
        void run(
          async () => {
            await actions.setArchived(session.id, true, session.profile);
            leaveIfOpen(session);
          },
          COPY.archived,
          COPY.archiveFailed,
        ),
    },
    {
      label: COPY.delete,
      destructive: true,
      onPress: () =>
        Alert.alert(COPY.deleteTitle, deleteSessionDescription(sessionTitle(session)), [
          { text: COPY.cancel, style: 'cancel' },
          {
            text: COPY.delete,
            style: 'destructive',
            onPress: () =>
              void run(
                async () => {
                  const entry = controller.getSnapshot().entries[session.id];
                  // deleting ends the turn: stop and close the live runtime first, as the desktop does
                  if (entry?.runtimeId) {
                    if (entry.transcript.running) await controller.rpc('session.interrupt', { session_id: entry.runtimeId, profile: entry.profile }).catch(() => undefined);
                    await controller.rpc('session.close', { session_id: entry.runtimeId, profile: entry.profile }).catch(() => undefined);
                  }
                  await actions.remove(session.id, session.profile);
                  leaveIfOpen(session);
                },
                COPY.deleted,
                COPY.deleteFailed,
              ),
          },
        ]),
    },
  ];

  const element = (
    <>
      <ActionSheet visible={target !== null} title={target ? sessionTitle(target) : undefined} actions={target ? sheetActions(target) : []} onClose={() => setTarget(null)} />
      <RenameSheet
        session={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(session, title) => run(() => actions.rename(session.id, title, session.profile), COPY.renamed, COPY.renameFailed)}
      />
    </>
  );

  /** desktop `clearUnreadOnOpen`: best-effort, a failed write is healed by the next refresh */
  const markRead = async (session: SessionInfo) => {
    try {
      await actions.setUnread(session.id, false, session.profile);
      void controller.refreshSessions();
    } catch {
      // the dot returns until a refresh reconciles
    }
  };

  return { open: setTarget, markRead, element };
}

function RenameSheet({ session, onClose, onSubmit }: { session: SessionInfo | null; onClose: () => void; onSubmit: (session: SessionInfo, title: string) => Promise<void> }) {
  const t = useTokens();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);

  // the field starts from the row's current title each time the sheet opens
  if (session && seen !== session.id) {
    setSeen(session.id);
    setValue(session.title ?? '');
  } else if (!session && seen !== null) {
    setSeen(null);
  }

  const submit = async () => {
    if (!session || submitting) return;
    const next = value.trim();
    if (next === (session.title ?? '').trim()) {
      onClose();
      return;
    }
    setSubmitting(true);
    await onSubmit(session, next);
    setSubmitting(false);
    onClose();
  };

  return (
    <Sheet visible={session !== null} onClose={submitting ? () => undefined : onClose}>
      <View style={styles.form}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>{COPY.renameTitle}</Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 2 }}>{COPY.renameDesc}</Text>
        <TextInput
          autoFocus
          selectTextOnFocus
          editable={!submitting}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          placeholder={COPY.untitled}
          placeholderTextColor={t.uiTextQuaternary}
          accessibilityLabel={COPY.renameTitle}
          style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
        />
        <View style={styles.buttons}>
          <ActionButton label={COPY.cancel} variant="ghost" disabled={submitting} onPress={onClose} />
          <ActionButton label={COPY.save} busy={submitting} onPress={() => void submit()} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  input: { fontSize: 15, paddingHorizontal: 12, minHeight: 44, marginTop: 12 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
});
