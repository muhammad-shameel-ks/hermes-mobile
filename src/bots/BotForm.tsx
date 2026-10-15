/**
 * New bot and Edit bot: a name and a description, the minimal flow the phone
 * carries (issue "Bot Mode surface design on a phone"). A new bot clones the
 * default profile, wears a blobatar that follows its name, and kicks off its Bot
 * Chat with the desktop's introduction prompt. SOUL editing and the avatar picker
 * are later work.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { BotAvatar } from './BotAvatar.tsx';
import { slugifyProfileName, type Bot, type BotMeta } from './roster.ts';

type Props = {
  visible: boolean;
  /** absent for a new bot */
  bot: Bot | null;
  onClose: () => void;
  onSubmit: (draft: { label: string; description: string }) => Promise<boolean>;
  loadImage: (name: string) => Promise<string | null>;
};

const NEW_BOT_META: BotMeta = { shape: 'blobatar' };

export default function BotForm({ visible, bot, onClose, onSubmit, loadImage }: Props) {
  const t = useTokens();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(bot?.label ?? '');
    setDescription(bot?.description ?? '');
    setBusy(false);
  }, [visible, bot]);

  const slug = slugifyProfileName(label);
  const valid = bot ? label.trim() !== '' : slug !== '';

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onSubmit({ label, description });
    setBusy(false);
    if (ok) onClose();
  };

  const input = [styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }];

  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose}>
      <View style={styles.body}>
        <View style={styles.header}>
          <BotAvatar
            name={bot?.name ?? (slug || 'agent')}
            meta={bot?.meta ?? NEW_BOT_META}
            hasAvatar={bot?.hasAvatar ?? false}
            size={56}
            loadImage={loadImage}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.uiTextPrimary, fontSize: 17, fontWeight: '600' }}>{bot ? `Edit ${bot.label}` : 'New bot'}</Text>
            <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {bot ? `Profile ${bot.name}` : slug ? `Profile ${slug}` : 'A named agent with its own memory and one chat'}
            </Text>
          </View>
        </View>

        <Text style={[styles.label, { color: t.uiTextTertiary }]}>Name</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="Scout"
          placeholderTextColor={t.uiTextQuaternary}
          style={input}
          editable={!busy}
          autoFocus={!bot}
          returnKeyType="next"
          accessibilityLabel="Bot name"
        />

        <Text style={[styles.label, { color: t.uiTextTertiary }]}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What is this bot for?"
          placeholderTextColor={t.uiTextQuaternary}
          style={[input, styles.multiline]}
          editable={!busy}
          multiline
          accessibilityLabel="Bot description"
        />

        <View style={styles.actions}>
          <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.secondary, { borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }, pressed && { opacity: 0.6 }]}>
            <Text style={{ color: t.uiTextSecondary, fontSize: 14 }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void submit()}
            disabled={!valid || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || busy, busy }}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: t.dtPrimarySolid, borderRadius: t.radius['3xl'] },
              (!valid || busy) && { opacity: 0.45 },
              pressed && { opacity: 0.75 },
            ]}
          >
            {busy ? <ActivityIndicator size="small" color={t.dtPrimarySolidForeground} /> : null}
            <Text style={{ color: t.dtPrimarySolidForeground, fontSize: 14, fontWeight: '600' }}>
              {bot ? 'Save' : busy ? 'Creating…' : 'Create bot'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  label: { fontSize: 12, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  multiline: { minHeight: 76, maxHeight: 140, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  secondary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primary: { flex: 2, minHeight: 46, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
});
