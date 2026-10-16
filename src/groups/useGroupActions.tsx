/**
 * Long-press actions on a group chat row (mirrors `useSessionActions.tsx`): open, rename, disband.
 * An action sheet picks the verb, a form sheet renames, and disband is confirmed. Copy follows the
 * desktop's `i18n.ts` `group` strings, with disband's description kept to its true meaning: the room
 * and its shared log go away, each bot keeps its own chats.
 */

import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ChatController } from '../chat/controller.ts';
import { errorText } from '../gateway/http.ts';
import { ActionButton } from '../settings/primitives.tsx';
import { ActionSheet, Sheet, type SheetAction } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import type { GroupsModel } from './model.ts';
import { MAX_GROUP_NAME, type GroupRoom } from './rooms.ts';

const COPY = {
  open: 'Open',
  rename: 'Rename…',
  disband: 'Disband',
  cancel: 'Cancel',
  save: 'Save',
  renameTitle: 'Rename group chat',
  renamed: 'Renamed',
  renameFailed: 'Rename failed',
  disbandTitle: 'Disband group chat?',
  disbandAction: 'Disband',
  disbanded: 'Group chat disbanded',
  disbandFailed: 'Disband failed',
};

export function useGroupActions(model: GroupsModel, controller: ChatController, onOpen: (room: GroupRoom) => void) {
  const [target, setTarget] = useState<GroupRoom | null>(null);
  const [renaming, setRenaming] = useState<GroupRoom | null>(null);

  const run = async (work: () => Promise<unknown>, done: string | null, failed: string) => {
    try {
      await work();
      if (done) controller.notify(done);
    } catch (error) {
      controller.notify(`${failed}. ${errorText(error)}`);
    }
  };

  const sheetActions = (room: GroupRoom): SheetAction[] => [
    { label: COPY.open, onPress: () => onOpen(room) },
    { label: COPY.rename, onPress: () => setRenaming(room) },
    {
      label: COPY.disband,
      destructive: true,
      onPress: () =>
        Alert.alert(COPY.disbandTitle, `This removes the group chat “${room.name}” and stops its bots from talking in it. Each bot keeps its own chats.`, [
          { text: COPY.cancel, style: 'cancel' },
          {
            text: COPY.disbandAction,
            style: 'destructive',
            onPress: () => void run(() => model.disband(room.id), COPY.disbanded, COPY.disbandFailed),
          },
        ]),
    },
  ];

  const element = (
    <>
      <ActionSheet visible={target !== null} title={target?.name} actions={target ? sheetActions(target) : []} onClose={() => setTarget(null)} />
      <RenameSheet
        room={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(room, name) => run(() => model.rename(room.id, name), COPY.renamed, COPY.renameFailed)}
      />
    </>
  );

  return { open: setTarget, element };
}

function RenameSheet({ room, onClose, onSubmit }: { room: GroupRoom | null; onClose: () => void; onSubmit: (room: GroupRoom, name: string) => Promise<void> }) {
  const t = useTokens();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);

  // the field starts from the room's current name each time the sheet opens
  if (room && seen !== room.id) {
    setSeen(room.id);
    setValue(room.name);
  } else if (!room && seen !== null) {
    setSeen(null);
  }

  const trimmed = value.trim();
  const unchanged = room !== null && trimmed === room.name;
  const disabled = submitting || trimmed === '' || unchanged;

  const submit = async () => {
    if (!room || disabled) return;
    setSubmitting(true);
    await onSubmit(room, trimmed);
    setSubmitting(false);
    onClose();
  };

  return (
    <Sheet visible={room !== null} onClose={submitting ? () => undefined : onClose}>
      <View style={styles.form}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>{COPY.renameTitle}</Text>
        <TextInput
          autoFocus
          selectTextOnFocus
          editable={!submitting}
          value={value}
          onChangeText={setValue}
          maxLength={MAX_GROUP_NAME}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          accessibilityLabel={COPY.renameTitle}
          style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
        />
        <View style={styles.buttons}>
          <ActionButton label={COPY.cancel} variant="ghost" disabled={submitting} onPress={onClose} />
          <ActionButton label={COPY.save} busy={submitting} disabled={disabled} onPress={() => void submit()} />
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
