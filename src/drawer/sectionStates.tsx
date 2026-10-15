/**
 * What a list says when it has no rows to show: the loading skeletons, an empty pinned section, a failed
 * read with its retry, the damaged-store notice (apps/desktop/src/app/chat/sidebar/section-states.tsx).
 * Each borrows the row geometry, so a placeholder resolves into the rows it stands for without the list
 * stepping sideways.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { ROW_GAP, ROW_LEAD, ROW_MIN_H, ROW_PAD_X, ROW_STACK_GAP } from './rowGeometry.ts';

const SKELETON_WIDTHS = [128, 160, 112, 144, 96];

/**
 * Five rows of the session row's own chrome with pulsing bars: tailwind's `animate-pulse`, 2 s,
 * 100% -> 50% -> 100% on `cubic-bezier(.4, 0, .6, 1)`. One shared value drives all five.
 */
export function SessionSkeletons() {
  const t = useTokens();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    const ease = Easing.bezier(0.4, 0, 0.6, 1);
    pulse.value = withRepeat(withSequence(withTiming(0.5, { duration: 1000, easing: ease }), withTiming(1, { duration: 1000, easing: ease })), -1, false);
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: ROW_STACK_GAP }}>
      {SKELETON_WIDTHS.map((width, index) => (
        <View key={`${width}-${index}`} style={styles.skeletonRow}>
          <View style={{ width: ROW_LEAD }} />
          <Animated.View style={[{ width, height: 12, borderRadius: t.radius.md, backgroundColor: t.dtAccent }, style]} />
          <View style={{ flex: 1 }} />
          <Animated.View style={[{ width: 14, height: 14, borderRadius: t.radius.sm, backgroundColor: t.dtAccent, opacity: 0.6 }]} />
        </View>
      ))}
    </View>
  );
}

/** `SidebarPinnedEmptyState`: the hint that stands where pinned rows will be; shift-click becomes long-press (#12) */
export function PinnedEmptyState() {
  const t = useTokens();
  return (
    <View style={styles.pinnedEmpty}>
      <View style={{ width: ROW_LEAD, alignItems: 'center' }}>
        <Codicon name="pin" size={12} color={t.uiTextQuaternary} />
      </View>
      <Text style={{ color: t.uiTextTertiary, fontSize: 12 }}>Long-press a chat to pin</Text>
    </View>
  );
}

/** a centred empty message: `grid min-h-16 place-items-center text-xs text-(--ui-text-tertiary)` */
export function EmptyMessage({ children, tall = false }: { children: string; tall?: boolean }) {
  const t = useTokens();
  return (
    <View style={[styles.empty, { minHeight: tall ? 96 : 64 }]}>
      <Text style={{ color: t.uiTextTertiary, fontSize: 12, lineHeight: 16, textAlign: 'center' }}>{children}</Text>
    </View>
  );
}

/**
 * `SidebarLoadErrorState`: a failed load must not share the "no sessions yet" copy, which reads as data
 * loss. An error glyph, one line, a ghost retry.
 */
export function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTokens();
  return (
    <View style={[styles.empty, { minHeight: 64, gap: 8 }]} accessibilityLiveRegion="polite">
      <Codicon name="error" size={16} color={t.uiTextQuaternary} />
      <Text style={{ color: t.uiTextTertiary, fontSize: 12 }}>Could not load sessions</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [styles.ghost, { borderRadius: t.radius['2xl'], backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent' }]}
      >
        <Codicon name="refresh" size={12} color={t.uiTextSecondary} />
        <Text style={{ color: t.uiTextSecondary, fontSize: 12, fontWeight: '500' }}>Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * `SidebarStorageCorruptNotice`: a structurally damaged `state.db` thins the list below it, which reads as
 * deleted history. Persistent while the backend reports it; there is nothing to dismiss.
 */
export function StorageCorruptNotice() {
  const t = useTokens();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderRadius: t.radius['2xl'], borderColor: mixDestructive(t.dtDestructive), backgroundColor: mixDestructive(t.dtDestructive, 0.08) }]}
    >
      <Codicon name="warning" size={14} color={t.dtDestructive} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: t.dtDestructive, fontSize: 12, fontWeight: '500' }}>Session database is damaged</Text>
        <Text style={{ color: t.uiTextSecondary, fontSize: 12, lineHeight: 16 }}>
          Hermes can't read all of the session history. Chats missing from this list were not deleted; the file they are stored in is damaged.
        </Text>
        <Text style={{ color: t.uiTextTertiary, fontSize: 12, lineHeight: 16 }}>
          Quit Hermes on this profile, then inspect the file without changing it, or restore a snapshot.
        </Text>
      </View>
    </View>
  );
}

const mixDestructive = (color: string, percent = 0.3) => mixPct(color, percent, 'transparent');

const styles = StyleSheet.create({
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP, minHeight: ROW_MIN_H, paddingLeft: ROW_PAD_X, paddingRight: ROW_PAD_X },
  pinnedEmpty: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP, minHeight: 28, paddingLeft: ROW_PAD_X },
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12 },
  notice: { flexDirection: 'row', gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
});
