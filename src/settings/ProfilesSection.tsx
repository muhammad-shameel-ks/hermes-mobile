/**
 * Settings → Profiles (desktop app/profiles + the sidebar's profile switcher):
 * the gateway's profiles as the phone's bots, with the active profile marked and
 * switchable. The active profile scopes the sessions list and new sessions; it
 * follows the bot whose chat is open. Creating, editing and deleting a bot stay
 * on the drawer's BOTS tab.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BotAvatar } from '../bots/BotAvatar.tsx';
import type { Bot } from '../bots/roster.ts';
import { useTokens } from '../ui/tokens.ts';
import { useSettings } from './context.tsx';
import { Pill, SettingsContent, SettingsSection } from './primitives.tsx';

/** desktop `profiles.title` / `profiles.count` / `profiles.loading`, and the chip sheet's intro */
const COPY = {
  title: 'Profiles',
  count: (n: number) => `${n} ${n === 1 ? 'profile' : 'profiles'}`,
  intro: 'Scopes the sessions list and new sessions.',
  loading: 'Loading profiles...',
  active: 'Active',
  default: 'Default',
  switchTo: (name: string) => `Switch to ${name}`,
};

export default function ProfilesSection() {
  const t = useTokens();
  const { controller, snapshot } = useSettings();
  const { visible, hidden, loaded, loading, error } = snapshot.roster;
  const bots = [...visible, ...hidden];
  const row = (bot: Bot) => {
    const active = bot.name === snapshot.profile;
    return (
      <Pressable
        key={bot.name}
        onPress={() => controller.useProfile(bot.name)}
        accessibilityRole="button"
        accessibilityLabel={COPY.switchTo(bot.label)}
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [styles.row, { borderRadius: t.radius['2xl'] }, (active || pressed) && { backgroundColor: t.uiRowActiveBackground }]}
      >
        <BotAvatar name={bot.name} meta={bot.meta} hasAvatar={bot.hasAvatar} size={34} loadImage={controller.avatarDataFn} />
        <View style={styles.text}>
          <Text numberOfLines={1} style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>
            {bot.label}
          </Text>
          <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: t.type.caption, marginTop: 2 }}>
            {bot.description || bot.name}
          </Text>
        </View>
        {active ? <Pill tone="success">{COPY.active}</Pill> : bot.isDefault ? <Pill>{COPY.default}</Pill> : null}
      </Pressable>
    );
  };

  return (
    <SettingsContent refreshing={loading} onRefresh={() => void controller.refreshRoster()}>
      <SettingsSection title={COPY.title} icon="account" meta={loaded ? COPY.count(bots.length) : undefined}>
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight, marginBottom: 8 }}>{COPY.intro}</Text>
        {!loaded && !error ? <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{COPY.loading}</Text> : null}
        {error ? <Text style={{ color: t.dtDestructive, fontSize: t.type.caption }}>{error}</Text> : null}
        {bots.map(row)}
      </SettingsSection>
    </SettingsContent>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 10, marginBottom: 2 },
  text: { flex: 1, minWidth: 0 },
});
