/**
 * New bot and Edit: a pushed screen with the avatar editor, a name (a title when
 * editing) and a description (issue "Bot Mode surface design on a phone"). A new
 * bot is created on Create only - cancelling leaves nothing behind - clones the
 * default profile, and kicks off its Bot Chat with the desktop's introduction.
 * SOUL editing and the capability editor are later work.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { OverlayScreen } from '../app/overlay.tsx';
import type { ChatController } from '../chat/controller.ts';
import { useTokens } from '../ui/tokens.ts';
import type { AvatarApi } from './avatarApi.ts';
import AvatarPicker from './AvatarPicker.tsx';
import { BotAvatar, primeAvatar } from './BotAvatar.tsx';
import { botAppearance } from './face.ts';
import { editedLook, isBackfilledFacePng, type EditableLook } from './look.ts';
import { slugifyProfileName, type Bot } from './roster.ts';

type Props = {
  /** absent for a new bot */
  bot: Bot | null;
  controller: ChatController;
  api: AvatarApi;
  /** profile names already taken, for the new-bot name check */
  takenNames: ReadonlySet<string>;
  onClose: () => void;
  /** a bot was created, so the screen behind can step aside too */
  onCreated?: () => void;
};

const noImage = async () => null;

export default function BotForm({ bot, controller, api, takenNames, onClose, onCreated }: Props) {
  const t = useTokens();
  const [label, setLabel] = useState(bot?.label ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appearance = bot ? botAppearance(bot.name, bot.meta) : { shape: 'blobatar', color: null };
  const [shape, setShape] = useState(appearance.shape);
  const [color, setColor] = useState<string | null>(appearance.color);
  const [image, setImage] = useState<string | null>(null);
  const [opened, setOpened] = useState<EditableLook>({ ...appearance, image: null, title: bot?.label ?? '' });
  // an existing picture has to arrive before the look can be edited or compared
  const [ready, setReady] = useState(!bot?.hasAvatar);

  useEffect(() => {
    if (!bot?.hasAvatar) return;
    let live = true;
    void controller.avatarData(bot.name).then((data) => {
      if (!live) return;
      const picture = data && !isBackfilledFacePng(data) ? data : null;
      setImage(picture);
      setOpened((prev) => ({ ...prev, image: picture }));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [bot, controller]);

  const slug = slugifyProfileName(label);
  const taken = !bot && slug !== '' && takenNames.has(slug);
  const valid = ready && (bot ? label.trim() !== '' : slug !== '' && !taken);
  const pickerName = bot?.name ?? (slug || 'agent');

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const started = Date.now();
    const look = bot ? editedLook(opened, { shape, color, image, title: label }) : null;
    const ok = bot
      ? await controller.editBot(bot, { label, description }, look)
      : await controller.createBot({ label, description }, { shape, color, image });
    if (!ok) {
      // notices draw behind a pushed screen, so the reason is shown here
      const notice = controller.getSnapshot().notice;
      setError(notice && notice.at >= started ? notice.text : 'Could not save. Try again.');
      controller.clearNotice();
      setBusy(false);
      return;
    }
    if (bot && look && 'image' in look) primeAvatar(bot.name, look.image ?? null);
    onClose();
    if (!bot) onCreated?.();
  };

  const input = [styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }];
  const action = bot ? 'Save' : 'Create';
  const disabled = !valid || busy;

  return (
    <OverlayScreen
      title={bot ? 'Edit profile' : 'New bot'}
      onBack={busy ? () => undefined : onClose}
      trailing={
        <Pressable
          onPress={() => void submit()}
          disabled={disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={bot ? 'Save' : 'Create bot'}
          accessibilityState={{ disabled, busy }}
          style={({ pressed }) => [styles.action, { backgroundColor: t.dtPrimarySolid, borderRadius: t.radius['3xl'] }, disabled && { opacity: 0.45 }, pressed && { opacity: 0.75 }]}
        >
          {busy ? <ActivityIndicator size="small" color={t.dtPrimarySolidForeground} /> : null}
          <Text style={{ color: t.dtPrimarySolidForeground, fontSize: 14, fontWeight: '600' }}>{action}</Text>
        </Pressable>
      }
    >
      <View style={[styles.header, { borderBottomColor: t.uiStrokeQuaternary }]}>
        <BotAvatar
          name={pickerName}
          meta={{ shape, color: color ?? undefined, custom: true }}
          hasAvatar={false}
          image={image}
          size={bot ? 64 : 56}
          loadImage={noImage}
        />
        <Text style={[styles.lede, { color: t.uiTextTertiary }]}>
          {bot
            ? `Appearance and role for ${bot.label} (${bot.name}).`
            : 'A named teammate with its own memory, skills, and chat. It can message your other agents.'}
        </Text>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        {ready ? (
          <AvatarPicker
            api={api}
            color={color}
            image={image}
            shape={shape}
            onColor={setColor}
            onImage={setImage}
            onShape={setShape}
            seed={{ name: pickerName, title: label, description }}
          />
        ) : (
          <ActivityIndicator color={t.uiTextTertiary} style={styles.loading} />
        )}

        <Text style={[styles.label, { color: t.uiTextTertiary }]}>{bot ? 'Title' : 'Name'}</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder={bot ? bot.label : 'Scout'}
          placeholderTextColor={t.uiTextQuaternary}
          style={input}
          editable={!busy}
          autoFocus={!bot}
          returnKeyType="next"
          accessibilityLabel={bot ? 'Bot title' : 'Bot name'}
        />
        {!bot && slug ? <Text style={[styles.caption, { color: taken ? t.uiAccent : t.uiTextQuaternary }]}>{taken ? `An agent named "${slug}" already exists.` : `Profile ${slug}`}</Text> : null}

        <Text style={[styles.label, { color: t.uiTextTertiary }]}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What should this bot help with?"
          placeholderTextColor={t.uiTextQuaternary}
          style={[input, styles.multiline]}
          editable={!busy}
          multiline
          accessibilityLabel="Bot description"
        />

        {error ? (
          <Text style={[styles.error, { color: t.dtDestructive, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  lede: { flex: 1, fontSize: 12, lineHeight: 17 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  loading: { paddingVertical: 32 },
  label: { fontSize: 12, marginTop: 16, marginBottom: 6 },
  caption: { fontSize: 11, marginTop: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  multiline: { minHeight: 76, maxHeight: 140, textAlignVertical: 'top' },
  error: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, marginTop: 16, fontSize: 12, lineHeight: 17 },
  action: { minHeight: 34, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
});
