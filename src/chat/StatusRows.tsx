/**
 * The status stack's shared chrome: the collapsible section and the row, ported
 * from the desktop's components/chat/status-section and status-row (and their
 * status-stack.css grid: action 0.75rem, glyph 0.8rem, content, trailing actions,
 * 0.375rem gaps). There is no hover on a phone, so a row's actions are always
 * drawn and carry touch-sized hit slops around the desktop's glyph sizes.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { DisclosureCaret } from '../ui/motion.tsx';
import { useTokens } from '../ui/tokens.ts';

/** desktop `text-[0.73rem] leading-4` row copy, `text-xs` section headers */
export const ROW_TEXT = 11.68;
export const HEADER_TEXT = 12;
const GLYPH = 12.8;
const ACTION = 12;
const GAP = 6;
const NEST = 4;

export function BrailleSpinner({ color, label, size = 13.6 }: { color: string; label: string; size?: number }) {
  return <GlyphSpinner spinner="braille" size={size} color={color} label={label} />;
}

/** the neutral, unfinished glyph shared by pending tasks: a dashed ring */
export function PendingGlyph({ color }: { color: string }) {
  return (
    <Svg width={11.2} height={11.2} viewBox="0 0 12 12" accessible={false}>
      <Circle cx={6} cy={6} r={5.5} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2.2 2" />
    </Svg>
  );
}

/** the small solid dot a finished background row leads with */
export function StateDot({ color }: { color: string }) {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />;
}

const stroke = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** the desktop's tabler icons on the queue (Layers3, Pencil, SteeringWheel, CornerDownLeft), drawn as paths */
export type StackIconName = 'layers' | 'pencil' | 'steer' | 'send';

const ICON_PATHS: Record<StackIconName, string[]> = {
  layers: ['M8 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -8', 'M4 10a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -8', 'M9 15l6 -6'],
  pencil: ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'],
  steer: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M12 14l0 7', 'M10 12l-6.75 -2', 'M14 12l6.75 -2'],
  send: ['M18 6v6a3 3 0 0 1 -3 3h-10l4 -4m0 8l-4 -4'],
};

export function StackIcon({ name, size = 14, color }: { name: StackIconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} stroke={color} {...stroke}>
      {ICON_PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

/** one icon button on a row: the desktop's 1.25rem square, with a phone-sized hit area around it */
export function RowButton({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: ReactNode }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => [styles.rowButton, { borderRadius: t.radius.md, opacity: disabled ? 0.4 : 1 }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
    >
      {children}
    </Pressable>
  );
}

/** a quiet text action beside a section header or row: the desktop's `micro` text button */
export function MicroButton({ label, onPress, hint }: { label: string; onPress: () => void; hint?: string }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      style={({ pressed }) => [styles.micro, { borderRadius: t.radius.md }, pressed && { backgroundColor: t.uiControlHoverBackground }]}
    >
      <Text allowFontScaling={false} style={{ color: t.uiTextSecondary, fontSize: 11 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function StatusSection({
  label,
  icon,
  accessory,
  collapsedIndicator,
  defaultCollapsed = true,
  preview,
  children,
}: {
  label: string;
  icon?: CodiconName;
  accessory?: ReactNode;
  /** an inline status beside the label, kept while the section is folded */
  collapsedIndicator?: ReactNode;
  defaultCollapsed?: boolean;
  /** compact live content that stays drawn while the section is folded */
  preview?: ReactNode;
  children: ReactNode;
}) {
  const t = useTokens();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <View>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={label}
          onPress={() => setCollapsed((open) => !open)}
          style={({ pressed }) => [styles.trigger, pressed && { backgroundColor: t.uiControlHoverBackground }]}
        >
          <DisclosureCaret open={!collapsed} size={HEADER_TEXT} color={t.uiTextSecondary} />
          {icon ? (
            <View style={styles.sectionIcon}>
              <Codicon name={icon} size={GLYPH} color={t.uiTextTertiary} />
            </View>
          ) : null}
          <Text numberOfLines={1} allowFontScaling={false} style={{ color: t.uiTextSecondary, fontSize: HEADER_TEXT, flexShrink: 1 }}>
            {label}
          </Text>
          {collapsedIndicator ? <View style={styles.indicator}>{collapsedIndicator}</View> : null}
        </Pressable>
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      {!collapsed || preview ? <View>{collapsed ? preview : children}</View> : null}
    </View>
  );
}

/**
 * One row: an optional leading action (the dismiss X), a glyph slot, the content
 * and trailing actions. `depth` indents nested todos one `--status-nest` per level.
 */
export function StatusRow({
  dismiss,
  leading,
  children,
  trailing,
  depth = 0,
  onActivate,
  expanded,
  last,
  highlighted,
}: {
  dismiss?: { label: string; onDismiss: () => void };
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  depth?: number;
  onActivate?: () => void;
  expanded?: boolean;
  /** the last row of a section's body keeps the desktop's roomier bottom padding */
  last?: boolean;
  highlighted?: boolean;
}) {
  const t = useTokens();
  const body = (
    <>
      <View style={styles.action}>
        {dismiss ? (
          <RowButton label={dismiss.label} onPress={dismiss.onDismiss}>
            <Codicon name="close" size={12.8} color={t.uiTextTertiary} />
          </RowButton>
        ) : null}
      </View>
      {leading !== undefined ? <View style={styles.glyph}>{leading}</View> : null}
      <View style={styles.content}>{children}</View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );
  const style = [
    styles.row,
    { paddingLeft: 8 + NEST + Math.min(depth, 4) * NEST, paddingBottom: last ? 6 : 4 },
    highlighted && { backgroundColor: t.uiControlActiveBackground },
  ];
  return onActivate ? (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onActivate} style={({ pressed }) => [style, pressed && { backgroundColor: t.uiControlHoverBackground }]}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  trigger: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  sectionIcon: { width: GLYPH, alignItems: 'center' },
  indicator: { flexDirection: 'row', alignItems: 'center' },
  accessory: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: GAP, paddingTop: 4, paddingRight: 10 },
  action: { width: ACTION, minHeight: 16, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: GLYPH, height: 16, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: GAP },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: -2 },
  rowButton: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  micro: { minHeight: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});
