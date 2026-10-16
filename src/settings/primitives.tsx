/**
 * The settings page's building blocks, ported from the desktop's
 * app/settings/primitives.tsx and components/ui/button.tsx: a titled section, the
 * one list row, a pill and the three button variants. Colours come from the
 * tokens; the phone only stacks a row's control under its description (the
 * desktop does the same below its `@2xl` container width) and lifts button
 * height to a touch target.
 */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { usePullRefresh } from '../ui/usePullRefresh.tsx';
/** `SettingsContent`: the scrolling page body */
export function SettingsContent({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const insets = useSafeAreaInsets();
  const pull = usePullRefresh({ refreshing: refreshing ?? false, onRefresh: onRefresh ?? (() => undefined), enabled: onRefresh !== undefined });
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12) + 40 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? pull.refreshControl : undefined}
      onScroll={onRefresh ? pull.track : undefined}
      scrollEventThrottle={onRefresh ? 16 : undefined}
    >
      {onRefresh ? pull.header : null}
      {children}
    </ScrollView>
  );
}

/** `SettingsSection`: heading plus body with the shared vertical rhythm */
export function SettingsSection({ title, icon, meta, aside, children }: { title: string; icon?: CodiconName; meta?: string; aside?: ReactNode; children: ReactNode }) {
  const t = useTokens();
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        {icon ? <Codicon name={icon} size={16} color={t.uiTextTertiary} /> : null}
        <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>{title}</Text>
        {meta ? <Pill>{meta}</Pill> : null}
        {aside ? <View style={styles.aside}>{aside}</View> : null}
      </View>
      {children}
    </View>
  );
}

/** `ListRow`: title and description, with the control under them */
export function ListRow({
  title,
  description,
  hint,
  action,
  onPress,
  trailing,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  hint?: string;
  action?: ReactNode;
  onPress?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTokens();
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, fontWeight: '500' }}>{title}</Text>
        {description ? (
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight, marginTop: 4 }}>{description}</Text>
        ) : null}
        {hint ? <Text style={{ color: t.uiTextQuaternary, fontFamily: MONO, fontSize: 11, marginTop: 4 }}>{hint}</Text> : null}
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
      {trailing}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.uiRowActiveBackground }, disabled && { opacity: 0.5 }]}
    >
      {body}
    </Pressable>
  );
}

/** `ToggleRow`: the one boolean row, a Switch beside the title and description */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTokens();
  return (
    <ListRow
      title={label}
      description={description}
      trailing={
        <Switch
          value={checked}
          disabled={disabled}
          accessibilityLabel={label}
          onValueChange={(on) => {
            void Haptics.selectionAsync().catch(() => {});
            onChange(on);
          }}
          trackColor={{ false: t.uiBgQuaternary, true: t.uiAccent }}
        />
      }
    />
  );
}

/** `SegmentedControl`: a tinted track with a raised active pill, for a short closed choice */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  const t = useTokens();
  return (
    <View style={[styles.track, { backgroundColor: t.uiBgTertiary }, disabled && { opacity: 0.5 }]}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync().catch(() => {});
              onChange(option.id);
            }}
            style={[styles.segment, active && { backgroundColor: t.uiBgChrome }]}
          >
            <Text numberOfLines={1} style={{ color: active ? t.uiTextPrimary : t.uiTextTertiary, fontSize: 12, fontWeight: '500' }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** a label and a value on one line, as the desktop's version details */
export function DetailRow({ label, value, mono, onPress }: { label: string; value: string; mono?: boolean; onPress?: () => void }) {
  const t = useTokens();
  const text = (
    <Text
      selectable={!onPress}
      style={[styles.detailValue, { color: onPress ? t.uiAccent : t.uiTextPrimary, fontSize: mono ? 12 : t.type.base }, mono && { fontFamily: MONO }]}
    >
      {value}
    </Text>
  );
  return (
    <View style={styles.detail}>
      <Text style={{ color: t.uiTextTertiary, fontSize: t.type.base }}>{label}</Text>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8} style={styles.detailValue}>
          {text}
        </Pressable>
      ) : (
        text
      )}
    </View>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'success' | 'destructive' }) {
  const t = useTokens();
  const color = tone === 'success' ? t.uiSuccess : tone === 'destructive' ? t.dtDestructive : t.uiTextSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius.full }]}>
      <Text style={{ color, fontSize: 11, fontWeight: '500' }}>{children}</Text>
    </View>
  );
}

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive';

/** the desktop Button: 12 px label, 2.5 px radius, soft fill for secondary, text-only ghost */
export function ActionButton({
  label,
  onPress,
  variant = 'default',
  icon,
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: CodiconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTokens();
  const fill =
    variant === 'default' ? t.dtPrimarySolid : variant === 'secondary' ? t.uiBgQuaternary : variant === 'destructive' ? t.dtDestructive : 'transparent';
  const color =
    variant === 'default' ? t.dtPrimarySolidForeground : variant === 'destructive' ? '#ffffff' : variant === 'secondary' ? t.uiTextPrimary : t.uiTextSecondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: fill, borderRadius: 2.5 },
        pressed && { opacity: 0.8 },
        (disabled || busy) && { opacity: 0.5 },
        style,
      ]}
    >
      {busy ? <GlyphSpinner size={14} color={color} /> : icon ? <Codicon name={icon} size={14} color={color} /> : null}
      <Text style={{ color, fontSize: 12, lineHeight: 16, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginBottom: 24 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, marginBottom: 10 },
  aside: { marginLeft: 'auto', minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rowText: { flex: 1, minWidth: 0 },
  action: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 6 },
  detailValue: { flex: 1, textAlign: 'right' },
  pill: { paddingHorizontal: 8, paddingVertical: 2 },
  track: { flexDirection: 'row', alignSelf: 'flex-start', padding: 2, gap: 2, borderRadius: 5 },
  segment: { minHeight: 36, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 3 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40 },
});
