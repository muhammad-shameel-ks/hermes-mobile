/**
 * The Settings overlay (issue "App shell and navigation on a phone"): the
 * desktop's in-place sub-nav becomes screen-to-screen drill-down. The root lists
 * the registry's sections; a row pushes that section's own screen, and back pops
 * to this list.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayScreen, useOverlay, type OverlayApi } from '../app/overlay.tsx';
import { Codicon } from '../ui/Codicon.tsx';
import { useTokens } from '../ui/tokens.ts';
import { SETTINGS_SECTIONS, type SettingsSectionEntry } from './sections.ts';

export const SETTINGS_OVERLAY_KEY = 'settings';

const sectionRoute = (section: SettingsSectionEntry) =>
  [
    `${SETTINGS_OVERLAY_KEY}:${section.key}`,
    (close: () => void) => (
      <OverlayScreen title={section.title} onBack={close}>
        {section.render()}
      </OverlayScreen>
    ),
  ] as const;

/** open Settings with one section on top, so back lands on the section list */
export function openSettingsSection(overlay: Pick<OverlayApi, 'push'>, key: string) {
  const section = SETTINGS_SECTIONS.find((entry) => entry.key === key);
  overlay.push(SETTINGS_OVERLAY_KEY, (close) => <SettingsScreen onBack={close} />);
  if (section) overlay.push(...sectionRoute(section));
}

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const overlay = useOverlay();

  const open = (section: SettingsSectionEntry) => overlay.push(...sectionRoute(section));

  return (
    <OverlayScreen title="Settings" onBack={onBack}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 24 }}>
        {SETTINGS_SECTIONS.map((section) => (
          <Pressable
            key={section.key}
            onPress={() => open(section)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, { borderRadius: t.radius['2xl'] }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
          >
            <View style={styles.lead}>{section.icon ? <Codicon name={section.icon} size={16} color={t.uiTextSecondary} /> : null}</View>
            <View style={styles.text}>
              <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>{section.title}</Text>
              {section.detail ? <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, marginTop: 2 }}>{section.detail}</Text> : null}
            </View>
            <Codicon name="chevron-right" size={14} color={t.uiTextQuaternary} />
          </Pressable>
        ))}
      </ScrollView>
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 },
  lead: { width: 20, alignItems: 'center' },
  text: { flex: 1, minWidth: 0 },
});
