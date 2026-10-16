/**
 * New group chat (apps/desktop/src/plugins/hermes-bots/create-dialog.tsx `CreateGroupChatDialog`): a
 * pushed screen that picks 2-6 bots, names the room and creates it. Cancelling leaves nothing behind -
 * the room exists only once Create succeeds.
 */

import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayScreen } from '../app/overlay.tsx';
import { BotAvatar } from '../bots/BotAvatar.tsx';
import { filterBots, type Bot } from '../bots/roster.ts';
import type { ChatController } from '../chat/controller.ts';
import { shallowEqual } from '../chat/selector.ts';
import { useChatSelector } from '../chat/useChatSelector.ts';
import { errorText } from '../gateway/http.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../ui/tokens.ts';
import { useGroups } from './hooks.ts';
import type { GroupsModel } from './model.ts';
import { botMentionHandle, defaultGroupName, newGroupProblem, MAX_GROUP_MEMBERS, MAX_GROUP_NAME, type GroupRoom } from './rooms.ts';

type Props = {
  controller: ChatController;
  model: GroupsModel;
  onClose: () => void;
  onCreated: (room: GroupRoom) => void;
};

const DRIVER_UNAVAILABLE = 'Group driver unavailable. Update or reconnect the owning gateway.';

export default function NewGroupScreen({ controller, model, onClose, onCreated }: Props) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { driver } = useGroups(model);
  const { visible, hidden } = useChatSelector(controller, (s) => s.roster, shallowEqual);
  const roster = useMemo(() => [...visible, ...hidden], [visible, hidden]);

  const [query, setQuery] = useState('');
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);

  const selected = useMemo(
    () => selectedNames.map((botName) => roster.find((bot) => bot.name === botName)).filter((bot): bot is Bot => bot !== undefined),
    [selectedNames, roster],
  );
  const problem = newGroupProblem(selected);
  const atCap = selected.length >= MAX_GROUP_MEMBERS;
  const visibleRows = useMemo(() => filterBots(roster, query), [roster, query]);
  const placeholder = selected.length ? defaultGroupName(selected) : 'Group name';

  const toggle = (botName: string) =>
    setSelectedNames((prev) => (prev.includes(botName) ? prev.filter((n) => n !== botName) : prev.length >= MAX_GROUP_MEMBERS ? prev : [...prev, botName]));

  const submit = async () => {
    if (problem !== null || busy || creating.current) return;
    creating.current = true;
    setBusy(true);
    setError(null);
    try {
      const room = await model.create(name.trim() || defaultGroupName(selected), selected);
      onCreated(room);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      creating.current = false;
    }
  };

  if (driver === false) {
    return (
      <OverlayScreen title="New group chat" onBack={onClose}>
        <View style={styles.unavailable}>
          <Codicon name="warning" size={24} color={t.uiTextQuaternary} />
          <Text style={{ color: t.uiTextTertiary, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{DRIVER_UNAVAILABLE}</Text>
        </View>
      </OverlayScreen>
    );
  }

  const input = [styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }];

  return (
    <OverlayScreen title="New group chat" onBack={busy ? () => undefined : onClose}>
      <KeyboardAwareScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text style={[styles.lede, { color: t.uiTextTertiary }]}>Pick 2 to 6 bots. Mention one with @name, or @everyone; a message with no mention goes to all of them.</Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search bots to add…"
          placeholderTextColor={t.uiTextQuaternary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search bots to add"
          style={input}
        />

        {selected.length > 0 ? (
          <View style={styles.chips}>
            {selected.map((bot) => (
              <Pressable
                key={bot.name}
                onPress={() => toggle(bot.name)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${bot.label} from selection`}
                style={[styles.chip, { backgroundColor: t.uiBgTertiary, borderRadius: t.radius.full }]}
              >
                <Text style={[styles.chipText, { color: t.uiTextSecondary }]}>{bot.label}</Text>
                <Codicon name="close" size={11} color={t.uiTextTertiary} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {visibleRows.length > 0 ? (
            visibleRows.map((bot) => {
              const checked = selectedNames.includes(bot.name);
              const disabled = !checked && atCap;
              return (
                <Pressable
                  key={bot.name}
                  onPress={() => toggle(bot.name)}
                  disabled={disabled}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled }}
                  accessibilityLabel={bot.label}
                  style={({ pressed }) => [styles.botRow, { borderRadius: t.radius.md }, pressed && !disabled && { backgroundColor: t.uiRowHoverBackground }, disabled && styles.dimmed]}
                >
                  <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={28} loadImage={controller.avatarDataFn} />
                  <View style={styles.botText}>
                    <Text numberOfLines={1} style={{ color: t.uiTextPrimary, fontSize: 15 }}>
                      {bot.label}
                    </Text>
                    <Text numberOfLines={1} style={{ color: t.uiTextQuaternary, fontSize: 12 }}>
                      @{botMentionHandle(bot)}
                    </Text>
                  </View>
                  {checked ? (
                    <Codicon name="check" size={16} color={t.uiAccent} />
                  ) : (
                    <View style={[styles.checkbox, { borderColor: t.uiStrokeSecondary }]} />
                  )}
                </Pressable>
              );
            })
          ) : (
            <Text style={[styles.noMatch, { color: t.uiTextTertiary }]}>{query.trim() ? `No bots match “${query.trim()}”` : 'No bots yet.'}</Text>
          )}
        </ScrollView>

        {selected.length >= 2 && problem ? (
          <Text style={[styles.problem, { color: t.dtDestructive }]} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        ) : null}

        <Text style={[styles.label, { color: t.uiTextTertiary }]}>Group name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={MAX_GROUP_NAME}
          placeholder={placeholder}
          placeholderTextColor={t.uiTextQuaternary}
          style={input}
          editable={!busy}
          accessibilityLabel="Group name"
        />

        {error ? (
          <Text style={[styles.error, { color: t.dtDestructive, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { borderTopColor: t.uiStrokeQuaternary, paddingBottom: 12 + insets.bottom }]}>
        <Pressable
          onPress={() => void submit()}
          disabled={problem !== null || busy}
          accessibilityRole="button"
          accessibilityLabel={selected.length ? `Create group (${selected.length})` : 'Create group'}
          accessibilityState={{ disabled: problem !== null || busy, busy }}
          style={({ pressed }) => [
            styles.create,
            { backgroundColor: t.dtPrimarySolid, borderRadius: t.radius['3xl'] },
            (problem !== null || busy) && { opacity: 0.45 },
            pressed && { opacity: 0.75 },
          ]}
        >
          {busy ? <GlyphSpinner size={14} color={t.dtPrimarySolidForeground} /> : null}
          <Text style={{ color: t.dtPrimarySolidForeground, fontSize: 15, fontWeight: '600' }}>{selected.length ? `Create group (${selected.length})` : 'Create group'}</Text>
        </Pressable>
      </View>
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, gap: 4 },
  lede: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '500' },
  list: { maxHeight: 260, marginTop: 12 },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 6 },
  botText: { flex: 1, minWidth: 0 },
  dimmed: { opacity: 0.45 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1 },
  noMatch: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  problem: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  label: { fontSize: 12, marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  error: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, marginTop: 16, fontSize: 12, lineHeight: 17 },
  footer: { paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  create: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
});
