/**
 * The way from the approval timed-out notice to the setting it names (desktop
 * `assistant.approval.openSafetySettings`, a toast action there): opens
 * Settings → Safety.
 */

import { Pressable, StyleSheet, Text } from 'react-native';

import { useOverlay } from '../app/overlay.tsx';
import { openSettingsSection } from '../settings/open.tsx';
import { useTokens } from '../ui/tokens.ts';
import { APPROVAL_COPY } from './requests.ts';

export function ApprovalTimedOutAction() {
  const t = useTokens();
  const overlay = useOverlay();
  return (
    <Pressable
      onPress={() => openSettingsSection(overlay, 'safety')}
      accessibilityRole="link"
      hitSlop={8}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: t.uiAccent, fontSize: t.type.caption, fontWeight: '500' }}>{APPROVAL_COPY.openSafetySettings}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginTop: 4 },
});
