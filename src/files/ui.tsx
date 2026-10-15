/**
 * Small pieces the Files, preview and Review screens share: header actions, the
 * preview's empty state (desktop `PreviewEmptyState`), its mode switcher, a toast
 * and a loading line.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { FileGlyph, type FileGlyphName } from './glyphs.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';

export function HeaderAction({ icon, label, onPress, busy, disabled }: { icon: FileGlyphName; label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.headerAction, (pressed || disabled) && { opacity: 0.5 }]}
    >
      {busy ? <GlyphSpinner size={14} color={t.uiTextTertiary} /> : <FileGlyph name={icon} size={16} color={t.uiTextSecondary} />}
    </Pressable>
  );
}

export function Loading({ label }: { label: string }) {
  const t = useTokens();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <GlyphSpinner size={14} color={t.uiTextTertiary} />
      <Text style={{ color: t.uiTextTertiary, fontSize: 12, marginTop: 10 }}>{label}</Text>
    </View>
  );
}

export function ErrorBanner({ text }: { text: string }) {
  const t = useTokens();
  return (
    <View style={[styles.banner, { backgroundColor: mixPct(t.dtDestructive, 0.1, 'transparent'), borderColor: mixPct(t.dtDestructive, 0.2, 'transparent') }]} accessibilityRole="alert">
      <Text style={{ color: t.dtDestructive, fontSize: 13, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

type EmptyAction = { label: string; onPress: () => void; disabled?: boolean };

/** desktop `PreviewEmptyState`: the cube, a title, a body, one pill action and one text link. */
export function EmptyState({
  title,
  body,
  primary,
  secondary,
  tone = 'neutral',
}: {
  title: string;
  body?: ReactNode;
  primary?: EmptyAction;
  secondary?: EmptyAction;
  tone?: 'neutral' | 'warning';
}) {
  const t = useTokens();
  const warning = tone === 'warning';
  const cube = warning ? mixPct(t.uiYellow, 0.7, 'transparent') : mixPct(t.dtForeground, 0.35, 'transparent');
  return (
    <View style={styles.center}>
      <Svg width={64} height={64} viewBox="0 0 64 64" accessible={false}>
        <Path d="M32 5 56 18.5v27L32 59 8 45.5v-27L32 5Z" fill="none" stroke={cube} strokeLinejoin="round" strokeWidth={1.25} />
        <Path d="M8 18.5 32 32l24-13.5M32 32v27" fill="none" stroke={cube} strokeLinejoin="round" strokeWidth={1.25} />
        <Path d="M20 11.75 44 25.25" fill="none" stroke={cube} strokeOpacity={0.45} strokeWidth={0.9} />
      </Svg>
      <Text style={{ color: t.uiTextPrimary, fontSize: 14, fontWeight: '500', marginTop: 20, textAlign: 'center' }}>{title}</Text>
      {body ? <Text style={{ color: t.uiTextTertiary, fontSize: 12, lineHeight: 19, marginTop: 8, textAlign: 'center', maxWidth: 320 }}>{body}</Text> : null}
      {primary ? (
        <Pressable
          onPress={primary.onPress}
          disabled={primary.disabled}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.pill,
            {
              backgroundColor: warning ? mixPct(t.uiYellow, 0.15, 'transparent') : t.uiChatSurfaceBackground,
              borderColor: warning ? mixPct(t.uiYellow, 0.4, 'transparent') : t.uiStrokePrimary,
            },
            (pressed || primary.disabled) && { opacity: 0.6 },
          ]}
        >
          <Text style={{ color: t.uiTextPrimary, fontSize: 12, fontWeight: '500' }}>{primary.label}</Text>
        </Pressable>
      ) : null}
      {secondary ? (
        <Pressable onPress={secondary.onPress} disabled={secondary.disabled} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [{ marginTop: 14 }, (pressed || secondary.disabled) && { opacity: 0.5 }]}>
          <Text style={{ color: t.uiTextTertiary, fontSize: 11, fontWeight: '500', textDecorationLine: 'underline' }}>{secondary.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** desktop `PreviewModeSwitcher`: SOURCE / PREVIEW / DIFF as underlined text, with a trailing slot. */
export function ModeSwitcher<T extends string>({ modes, active, labels, onSelect, trailing }: { modes: readonly T[]; active: T; labels: Record<T, string>; onSelect: (mode: T) => void; trailing?: ReactNode }) {
  const t = useTokens();
  if (modes.length < 2 && !trailing) return null;
  return (
    <View style={[styles.modes, { borderBottomColor: mixPct(t.uiStrokeSecondary, 0.8, 'transparent') }]} accessibilityRole="tablist">
      {modes.length > 1
        ? modes.map((mode) => {
            const selected = mode === active;
            return (
              <Pressable key={mode} onPress={() => onSelect(mode)} hitSlop={8} accessibilityRole="tab" accessibilityState={{ selected }}>
                <Text
                  style={{
                    color: selected ? t.uiTextPrimary : t.uiTextTertiary,
                    fontSize: 10,
                    fontWeight: '700',
                    textDecorationLine: selected ? 'underline' : 'none',
                  }}
                >
                  {labels[mode]}
                </Text>
              </Pressable>
            );
          })
        : null}
      {trailing}
    </View>
  );
}

export type ToastApi = { show: (text: string, tone?: 'success' | 'error') => void; node: ReactNode };

/** A bottom pill that clears itself, for the outcome of an action (the dashboard's toasts). */
export function useToast(): ToastApi {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ id: number; text: string; tone: 'success' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const show = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: nextId.current++, text, tone });
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const node = toast ? (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(160)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + 16,
          backgroundColor: t.uiBgElevated,
          borderColor: toast.tone === 'error' ? mixPct(t.dtDestructive, 0.4, 'transparent') : t.uiStrokeSecondary,
          borderRadius: t.radius['3xl'],
        },
      ]}
    >
      <Text style={{ color: toast.tone === 'error' ? t.dtDestructive : t.uiTextPrimary, fontSize: 13, lineHeight: 18 }}>{toast.text}</Text>
    </Animated.View>
  ) : null;

  return { show, node };
}

const styles = StyleSheet.create({
  headerAction: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 40 },
  banner: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  pill: { marginTop: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  modes: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  toast: { position: 'absolute', left: 16, right: 16, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, elevation: 6 },
});
