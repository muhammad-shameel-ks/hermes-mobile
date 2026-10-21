/**
 * Filing bots into user sections (sections.ts), the desktop's bot-row "Move to section" submenu and its
 * section-heading menu (bot-row.tsx, user-sections-ui.tsx). Copy follows the desktop's `i18n.ts`
 * `sections` strings.
 *
 * Parity deviations: the desktop's drag-and-drop, its toolbar "New section" (an empty section is local to
 * the machine that made it, and there is no such record here) and Move up / Move down (order is local
 * there too; here sections sort by name) are not ported. A delete is confirmed, where the desktop offers
 * Undo on a toast, which the phone's notices do not carry.
 */

import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Bot } from '../bots/roster.ts';
import { botSectionId, MAX_SECTION_NAME, newSectionId, rosterSections, sectionMembers, type BotSection } from '../bots/sections.ts';
import type { ChatController } from '../chat/controller.ts';
import { ActionButton } from '../settings/primitives.tsx';
import { ActionSheet, Sheet, type SheetAction } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';

const COPY = {
  moveTo: 'Move to section',
  current: 'Current',
  newSection: 'New section…',
  removeFromSection: 'Remove from section',
  rename: 'Rename…',
  delete: 'Delete',
  cancel: 'Cancel',
  create: 'Create',
  save: 'Save',
  newTitle: 'New section',
  renameTitle: 'Rename section',
  nameLabel: 'Section name',
  namePlaceholder: 'e.g. Clients',
  bots: (count: number) => `${count} ${count === 1 ? 'bot' : 'bots'}`,
  deleteTitle: (name: string) => `Delete “${name}”?`,
  deleteBody: (count: number) => `Its ${count === 1 ? 'bot moves' : `${count} bots move`} to Unassigned. No bot is deleted.`,
  deleted: (name: string, count: number) => `Deleted “${name}” — ${count} ${count === 1 ? 'bot' : 'bots'} moved to Unassigned`,
};

type Naming = { mode: 'create'; bot: Bot } | { mode: 'rename'; section: BotSection };

export function useSectionActions(controller: ChatController) {
  /** the bot whose "Move to section" picker is open */
  const [filing, setFiling] = useState<Bot | null>(null);
  /** the section whose heading was long-pressed */
  const [target, setTarget] = useState<BotSection | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);

  // read at the moment of the action, so a refresh since the sheet opened is not undone
  const allBots = () => {
    const { visible, hidden } = controller.getSnapshot().roster;
    return [...visible, ...hidden];
  };

  const filingActions = (bot: Bot): SheetAction[] => {
    const current = botSectionId(bot);
    return [
      ...rosterSections(allBots()).map((section) => ({
        label: section.name,
        detail: section.id === current ? COPY.current : undefined,
        onPress: () => {
          if (section.id !== current) void controller.moveBotsToSection([bot], section);
        },
      })),
      { label: COPY.newSection, onPress: () => setNaming({ mode: 'create', bot }) },
      ...(current ? [{ label: COPY.removeFromSection, onPress: () => void controller.moveBotsToSection([bot], null) }] : []),
    ];
  };

  const confirmDelete = (section: BotSection) => {
    const members = sectionMembers(allBots(), section.id);
    Alert.alert(COPY.deleteTitle(section.name), COPY.deleteBody(members.length), [
      { text: COPY.cancel, style: 'cancel' },
      {
        text: COPY.delete,
        style: 'destructive',
        onPress: () =>
          void controller.moveBotsToSection(members, null).then((moved) => {
            if (moved) controller.notify(COPY.deleted(section.name, members.length));
          }),
      },
    ]);
  };

  const sectionActions = (section: BotSection): SheetAction[] => [
    { label: COPY.rename, onPress: () => setNaming({ mode: 'rename', section }) },
    { label: COPY.delete, destructive: true, onPress: () => confirmDelete(section) },
  ];

  const submitName = async (name: string) => {
    if (!naming) return;
    if (naming.mode === 'create') {
      await controller.moveBotsToSection([naming.bot], { id: newSectionId(), name });
      return;
    }
    // members carry the name with their filing, so a rename re-stamps every one of them
    const { id } = naming.section;
    await controller.moveBotsToSection(sectionMembers(allBots(), id), { id, name });
  };

  const element = (
    <>
      <ActionSheet
        visible={filing !== null}
        title={COPY.moveTo}
        subtitle={filing?.label}
        actions={filing ? filingActions(filing) : []}
        onClose={() => setFiling(null)}
      />
      <ActionSheet
        visible={target !== null}
        title={target?.name}
        subtitle={target ? COPY.bots(sectionMembers(allBots(), target.id).length) : undefined}
        actions={target ? sectionActions(target) : []}
        onClose={() => setTarget(null)}
      />
      <SectionNameSheet naming={naming} onClose={() => setNaming(null)} onSubmit={submitName} />
    </>
  );

  return { file: setFiling, open: setTarget, element };
}

function SectionNameSheet({ naming, onClose, onSubmit }: { naming: Naming | null; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useTokens();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [seen, setSeen] = useState<Naming | null>(null);

  // the field starts blank for a new section and from the current name for a rename, each time the sheet opens
  if (naming !== seen) {
    setSeen(naming);
    if (naming) setValue(naming.mode === 'rename' ? naming.section.name : '');
  }

  const creating = naming?.mode === 'create';
  const title = creating ? COPY.newTitle : COPY.renameTitle;
  const trimmed = value.trim();
  const unchanged = naming?.mode === 'rename' && trimmed === naming.section.name;
  const disabled = submitting || trimmed === '' || unchanged;

  const submit = async () => {
    if (!naming || disabled) return;
    setSubmitting(true);
    await onSubmit(trimmed);
    setSubmitting(false);
    onClose();
  };

  return (
    <Sheet visible={naming !== null} onClose={submitting ? () => undefined : onClose}>
      <View style={styles.form}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        <TextInput
          autoFocus
          selectTextOnFocus
          editable={!submitting}
          value={value}
          onChangeText={setValue}
          maxLength={MAX_SECTION_NAME}
          placeholder={COPY.namePlaceholder}
          placeholderTextColor={t.uiTextQuaternary}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          accessibilityLabel={COPY.nameLabel}
          style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
        />
        <View style={styles.buttons}>
          <ActionButton label={COPY.cancel} variant="ghost" disabled={submitting} onPress={onClose} />
          <ActionButton label={creating ? COPY.create : COPY.save} busy={submitting} disabled={disabled} onPress={() => void submit()} />
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
