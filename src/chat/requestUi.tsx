/**
 * The small controls the request cards and prompt sheets share: the desktop's
 * text buttons, a form field, the letter badge on a clarify choice, and the
 * Tabler glyphs those cards lead with (the desktop's lucide-style icon set,
 * 24px grid, 2px stroke).
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'destructive' | 'ghost';

/** desktop `buttonVariants`: padding-sized, 12px medium text, a 2.5px radius; `xs` is the clarify card's size */
export function RequestButton({
  label,
  onPress,
  variant = 'primary',
  size = 'sm',
  disabled,
  busy,
  trailing,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'xs' | 'sm';
  disabled?: boolean;
  busy?: boolean;
  trailing?: ReactNode;
  accessibilityLabel?: string;
}) {
  const t = useTokens();
  const dark = t.renderedMode === 'dark';
  const palette = {
    primary: { bg: t.dtPrimarySolid, fg: t.dtPrimarySolidForeground },
    secondary: { bg: mixPct(t.uiAccent, 0.05, mixPct(t.dtForeground, 0.04, 'transparent')), fg: t.uiTextPrimary },
    text: { bg: 'transparent', fg: t.uiTextSecondary },
    ghost: { bg: 'transparent', fg: t.uiTextSecondary },
    destructive: { bg: dark ? mixPct(t.dtDestructive, 0.6, 'transparent') : t.dtDestructive, fg: '#ffffff' },
  }[variant];
  const inert = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.button,
        size === 'xs' ? styles.buttonXs : styles.buttonSm,
        { backgroundColor: palette.bg },
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={palette.fg} style={styles.spinner} />
      ) : (
        <>
          <Text style={[styles.buttonText, size === 'xs' && styles.buttonTextXs, { color: palette.fg }]}>{label}</Text>
          {trailing}
        </>
      )}
    </Pressable>
  );
}

/** a form control on the sheet: the app's field chrome, phone-sized text */
export function RequestInput(props: TextInputProps) {
  const t = useTokens();
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      placeholderTextColor={t.uiTextTertiary}
      selectionColor={t.uiAccent}
      {...props}
      style={[
        styles.input,
        { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.md, fontSize: t.type.base },
        props.style,
      ]}
    />
  );
}

/** desktop `Kbd` size sm: the letter that labels a clarify choice (A, B, C…) */
export function KeyBadge({ char, selected, disabled }: { char: string; selected: boolean; disabled?: boolean }) {
  const t = useTokens();
  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: selected ? t.dtPrimarySolid : mixPct(t.uiStrokeSecondary, 0.75, 'transparent'),
          backgroundColor: selected ? t.dtPrimarySolid : mixPct(t.uiBgElevated, 0.94, t.dtForeground),
        },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text allowFontScaling={false} style={[styles.badgeText, { color: selected ? '#ffffff' : mixPct(t.dtForeground, 0.58, 'transparent') }]}>
        {char}
      </Text>
    </View>
  );
}

const TABLER = {
  'message-question': [
    'M8 9h8',
    'M8 13h6',
    'M14 18h-1l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v4.5',
    'M19 22v.01',
    'M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483',
  ],
  'circle-letter-a': ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M10 16v-6a2 2 0 1 1 4 0v6', 'M10 13h4'],
  lock: ['M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6', 'M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0', 'M8 11v-4a4 4 0 1 1 8 0v4'],
  key: [
    'M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0',
    'M15 9h.01',
  ],
  'shield-lock': ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3', 'M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M12 12l0 2.5'],
  'alert-triangle': [
    'M12 9v4',
    'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0',
    'M12 16h.01',
  ],
} as const;

export type TablerName = keyof typeof TABLER;

export function TablerIcon({ name, size = 16, color }: { name: TablerName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      {TABLER[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 2.5 },
  buttonSm: { paddingHorizontal: 10, paddingVertical: 4 },
  buttonXs: { paddingHorizontal: 8, paddingVertical: 2, gap: 4 },
  buttonText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  buttonTextXs: { fontSize: 11 },
  spinner: { transform: [{ scale: 0.6 }], height: 16 },
  input: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  badge: { width: 18, height: 18, marginTop: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 3.2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 12 },
});
