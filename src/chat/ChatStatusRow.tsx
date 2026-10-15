/**
 * The status row under the composer (desktop app/shell/statusbar-controls.tsx,
 * trimmed to what the phone has): the profile chip and the Backend item.
 *
 * A Bot Chat hides both, as the desktop does - `profile-switcher` shows only while
 * sessions are showing and `gateway-health` hides while bots are showing - and the
 * row collapses to the bottom inset alone so the composer still clears the home bar.
 */

import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Codicon } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { tick } from '../ui/haptics.ts';
import type { Tokens } from '../ui/tokens.ts';
import type { GatewayHealth, HealthTone } from './backendHealth.ts';
import type { BackendAnchor } from './BackendPopover.tsx';
import { useKeyboardOpen } from './useKeyboardOpen.ts';

/** Tailwind amber-600, the desktop's degraded tone */
const AMBER = '#d97706';

export function healthColor(t: Tokens, tone: HealthTone): string {
  return tone === 'default' ? t.uiTextTertiary : tone === 'warn' ? AMBER : t.dtDestructive;
}

type Props = {
  t: Tokens;
  health: GatewayHealth;
  profileLabel: string;
  /** a Bot Chat hides the whole row */
  botChat: boolean;
  backendOpen: boolean;
  onProfile: () => void;
  onBackend: (anchor: BackendAnchor) => void;
};

export function ChatStatusRow({ t, health, profileLabel, botChat, backendOpen, onProfile, onBackend }: Props) {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardOpen();
  const frame = useRef({ x: 0, height: 0 });
  if (botChat) return <View style={{ height: keyboardVisible ? 0 : Math.max(insets.bottom, 4) }} />;

  const color = healthColor(t, health.tone);
  return (
    <View
      style={[styles.statusRow, { paddingBottom: keyboardVisible ? 4 : Math.max(insets.bottom, 4) }]}
      onLayout={(e) => {
        frame.current.height = e.nativeEvent.layout.height;
      }}
    >
      <Pressable
        onPress={onProfile}
        accessibilityRole="button"
        accessibilityLabel={`Profile: ${profileLabel}`}
        style={({ pressed }) => [styles.statusItem, pressed && { backgroundColor: t.uiControlHoverBackground }]}
      >
        <Codicon name="account" size={12} color={t.uiTextTertiary} />
        <Text style={[styles.statusText, { color: t.uiTextTertiary, maxWidth: 160 }]} numberOfLines={1}>
          {profileLabel}
        </Text>
        <Codicon name="chevron-down" size={14} color={t.uiTextTertiary} style={{ opacity: 0.6 }} />
      </Pressable>
      <Pressable
        onPress={() => {
          tick();
          onBackend({ x: frame.current.x, bottom: frame.current.height });
        }}
        onLayout={(e) => {
          frame.current.x = e.nativeEvent.layout.x;
        }}
        accessibilityRole="button"
        accessibilityLabel={`${health.label} ${health.detail}`}
        accessibilityHint={health.title}
        accessibilityState={{ expanded: backendOpen }}
        hitSlop={{ top: 8, bottom: 8 }}
        style={({ pressed }) => [styles.statusItem, (pressed || backendOpen) && { backgroundColor: t.uiControlHoverBackground }]}
      >
        {health.icon === 'spinner' ? (
          <GlyphSpinner size={12} color={color} label={health.detail} />
        ) : (
          <Codicon name={health.icon === 'pulse' ? 'pulse' : 'warning'} size={12} color={color} />
        )}
        <Text style={[styles.statusText, { color }]}>{health.label}</Text>
        <Text style={[styles.statusText, { color: t.uiTextQuaternary }]}>{health.detail}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, minHeight: 20 },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 6 },
  statusText: { fontSize: 11 },
});
