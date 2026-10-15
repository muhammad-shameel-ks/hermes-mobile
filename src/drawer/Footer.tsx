/**
 * The drawer's footer chips (issue #12): the gateway's health and the active profile, where the desktop's
 * statusbar keeps its connection and profile switchers (apps/desktop/src/app/chat/sidebar/
 * connection-switcher.tsx, profile-dropdown-switcher.tsx, components/ui/profile-glyph.tsx), then
 * Settings and Sign out. Ghost chips at 0.6875rem, a lead glyph and a trailing chevron where a menu
 * opens. Parity deviation (touch): 40dp tall.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { profileColor } from '../bots/face.ts';
import type { LinkState } from '../gateway/link.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { connectionGlyphName, connectionKind } from './connectionGlyph.ts';
import { profileColorSoft, profileInitial } from './profileGlyph.ts';
import { ROW_MIN_H } from './rowGeometry.ts';
import { useDrawerRoutes } from './useDrawerRoutes.tsx';

type Props = {
  link: LinkState;
  connectionLabel: string;
  connectionUrl: string;
  profileName: string;
  profileLabel: string;
  /** desktop statusbar `profile-switcher`: shown only while the sessions list is, never in Bot Mode */
  showProfile: boolean;
  onProfileChip: () => void;
  onSignOut: () => void;
  onClose: () => void;
};

/** `ProfileGlyph`: the default profile is the home glyph, any other a soft tint of its colour carrying its initial */
function ProfileGlyph({ name, label }: { name: string; label: string }) {
  const t = useTokens();
  const color = profileColor(name);
  if (!color) {
    return (
      <View style={styles.glyph}>
        <Codicon name="home" size={12} color={t.uiTextQuaternary} />
      </View>
    );
  }
  return (
    <View style={[styles.glyph, { borderRadius: 3, backgroundColor: profileColorSoft(color, 22) }]}>
      <Text allowFontScaling={false} style={{ color, fontSize: 7, lineHeight: 9, fontWeight: '600' }}>
        {profileInitial(label)}
      </Text>
    </View>
  );
}

export function Footer({ link, connectionLabel, connectionUrl, profileName, profileLabel, showProfile, onProfileChip, onSignOut, onClose }: Props) {
  const t = useTokens();
  const routes = useDrawerRoutes(onClose);
  const healthy = link.kind === 'open';
  const health = healthy ? t.uiSuccess : link.kind === 'connecting' ? t.uiTextTertiary : t.dtDestructive;
  const chip = ({ pressed }: { pressed: boolean }) => [styles.chip, { borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlActiveBackground : 'transparent' }];

  return (
    <View style={styles.footer}>
      <View style={styles.chip} accessible accessibilityLabel={`Gateway ${connectionLabel}, ${healthy ? 'connected' : link.kind === 'connecting' ? 'connecting' : 'not connected'}`}>
        <View style={styles.glyph}>
          <Codicon name={connectionGlyphName(connectionKind(connectionUrl))} size={12} color={t.uiTextQuaternary} />
        </View>
        <Text numberOfLines={1} style={[styles.chipText, { color: t.uiTextSecondary, fontFamily: MONO, maxWidth: 112 }]}>
          {connectionLabel}
        </Text>
        <View style={[styles.health, { backgroundColor: health }]} />
      </View>
      {showProfile ? (
        <Pressable onPress={onProfileChip} accessibilityRole="button" accessibilityLabel={`Active profile ${profileLabel}`} style={chip}>
          <ProfileGlyph name={profileName} label={profileLabel} />
          <Text numberOfLines={1} style={[styles.chipText, { color: t.uiTextSecondary, maxWidth: 96 }]}>
            {profileLabel}
          </Text>
          <View style={{ opacity: 0.6 }}>
            <Codicon name="chevron-down" size={14} color={t.uiTextSecondary} />
          </View>
        </Pressable>
      ) : null}
      <Pressable onPress={routes.openSettings} accessibilityRole="button" accessibilityLabel="Settings" style={chip}>
        <View style={styles.glyph}>
          <Codicon name="settings-gear" size={12} color={t.uiTextSecondary} />
        </View>
        <Text style={[styles.chipText, { color: t.uiTextSecondary }]}>Settings</Text>
      </Pressable>
      <Pressable onPress={onSignOut} accessibilityRole="button" style={chip}>
        <Text style={[styles.chipText, { color: t.uiTextTertiary }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: ROW_MIN_H, paddingHorizontal: 8 },
  chipText: { fontSize: 11, lineHeight: 14 },
  glyph: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  health: { width: 6, height: 6, borderRadius: 3, marginLeft: 2 },
});

