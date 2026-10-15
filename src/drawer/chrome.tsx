/**
 * The drawer's shared chrome, composed from the row geometry: the borderless search field, the section
 * label, the date divider, the nav row and the load-more affordance (apps/desktop/src/app/chat/sidebar/
 * chrome.tsx, load-more-row.tsx, app/shell/sidebar-label.tsx, components/ui/search-field.tsx).
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { DisclosureCaret } from '../ui/motion.tsx';
import { useTokens } from '../ui/tokens.ts';
import { tick } from '../ui/haptics.ts';
import { LABEL_LINE, LABEL_SIZE, ROW_MIN_H, ROW_PAD_X } from './rowGeometry.ts';

/**
 * `SearchField`: no box, a quiet search glyph, text-xs, resting at 30% until focused or filled. The
 * clear button and the busy spinner trail the text. Parity deviation (touch): 40dp tall.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  loading = false,
  rest = 0.3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  loading?: boolean;
  /** the resting opacity: the sessions field's 30%, the roster's 50% */
  rest?: number;
}) {
  const t = useTokens();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.search, { opacity: value || focused ? 1 : rest }]}>
      <Codicon name="search" size={14} color={t.uiTextTertiary} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={t.uiTextTertiary}
        style={[styles.searchInput, { color: t.dtForeground }]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {loading ? (
        <GlyphSpinner size={12} color={t.uiTextTertiary} label="Searching" />
      ) : value ? (
        <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} style={styles.clear}>
          <Codicon name="close" size={14} color={t.uiTextTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** `SidebarPanelLabel`'s square: an 8 dp checker of the label colour, `repeating-conic-gradient` at 1 dp a cell */
const DITHER = (() => {
  const cells: string[] = [];
  for (let row = 0; row < 8; row += 1) for (let col = 0; col < 8; col += 1) if ((row + col) % 2 === 1) cells.push(`M${col} ${row}h1v1h-1z`);
  return cells.join('');
})();

export function Dither({ color }: { color: string }) {
  return (
    <Svg width={8} height={8} viewBox="0 0 8 8" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={DITHER} fill={color} />
    </Svg>
  );
}

/**
 * A section's header: the dithered label in the skin's primary, 0.64rem semibold uppercase at 0.16em, a
 * caret that opens and closes it, the muted meta beside it. Parity deviation (touch): the caret is always
 * shown, where the desktop reveals it on hover, and the 32 dp header borrows its hit area from the gap.
 */
export function SectionHeader({
  label,
  open,
  onToggle,
  meta,
  icon,
}: {
  label: string;
  open?: boolean;
  onToggle?: () => void;
  meta?: ReactNode;
  icon?: ReactNode;
}) {
  const t = useTokens();
  const body = (
    <>
      {icon}
      <Dither color={t.uiAccentSecondary} />
      <Text numberOfLines={1} style={[styles.sectionLabel, { color: t.uiAccentSecondary }]}>
        {label}
      </Text>
      {meta ? <Text style={[styles.meta, { color: t.uiTextQuaternary }]}>{meta}</Text> : null}
      {onToggle ? <DisclosureCaret open={open ?? true} size={12} color={t.uiTextTertiary} /> : null}
    </>
  );
  return onToggle ? (
    <Pressable
      onPress={() => {
        tick();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={{ top: 4, bottom: 4 }}
      style={styles.sectionHeader}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.sectionHeader}>{body}</View>
  );
}

/**
 * `SidebarDateDivider`: a caption (0.64rem semibold uppercase at 0.12em) and a hairline, grouping
 * sessions by recency without a level of indentation. Tapping it folds the group beneath.
 */
export function DateDivider({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={() => {
        tick();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={styles.divider}
    >
      <Text style={[styles.dividerLabel, { color: t.uiTextQuaternary }]}>{label}</Text>
      <DisclosureCaret open={open} size={12} color={t.uiTextTertiary} />
      <View style={[styles.rule, { backgroundColor: t.uiStrokeTertiary }]} />
    </Pressable>
  );
}

/**
 * A nav row (the desktop's `SidebarMenuButton`): a 16 dp glyph at 72%, 0.8125rem medium secondary text,
 * the control-hover wash while pressed. Parity deviation (touch): 40dp, not 28.
 */
export function NavRow({ label, icon, onPress }: { label: string; icon: CodiconName; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.nav, { borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent' }]}
    >
      <View style={{ opacity: 0.72 }}>
        <Codicon name={icon} size={16} color={t.uiTextSecondary} />
      </View>
      <Text numberOfLines={1} style={[styles.navLabel, { color: t.uiTextSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `SidebarLoadMoreRow`: a compact ellipsis hanging off the end of the list, repeating the rows' trailing
 * inset. Parity deviation (touch): the 20 dp button sits in a 40 dp hit area.
 */
export function LoadMoreRow({ onPress, loading = false, step = 0 }: { onPress: () => void; loading?: boolean; step?: number }) {
  const t = useTokens();
  const label = loading ? 'Loading…' : step > 0 ? `Load ${step} more` : 'Load more';
  return (
    <View style={styles.loadMoreRow}>
      <Pressable
        onPress={onPress}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: loading, disabled: loading }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={({ pressed }) => [styles.loadMore, { borderRadius: t.radius.sm, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent', opacity: loading ? 0.6 : 1 }]}
      >
        {loading ? <GlyphSpinner size={12} color={t.uiTextTertiary} label={label} /> : <Codicon name="ellipsis" size={12} color={t.uiTextTertiary} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, minHeight: ROW_MIN_H },
  searchInput: { flex: 1, minWidth: 0, fontSize: 12, paddingVertical: 8 },
  clear: { alignItems: 'center', justifyContent: 'center', width: 20, height: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 32, paddingTop: 6, paddingBottom: 4, paddingLeft: ROW_PAD_X, paddingRight: 12 },
  sectionLabel: { fontSize: 10.24, lineHeight: 10.24, fontWeight: '600', letterSpacing: 1.64, textTransform: 'uppercase', flexShrink: 1 },
  meta: { fontSize: 11, fontWeight: '500' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28, paddingHorizontal: ROW_PAD_X, paddingTop: 8, paddingBottom: 2 },
  dividerLabel: { fontSize: 10.24, lineHeight: 12, fontWeight: '600', letterSpacing: 1.23, textTransform: 'uppercase' },
  rule: { flex: 1, minWidth: 16, height: StyleSheet.hairlineWidth },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ROW_MIN_H, paddingHorizontal: ROW_PAD_X },
  navLabel: { fontSize: LABEL_SIZE, lineHeight: LABEL_LINE, fontWeight: '500', flexShrink: 1 },
  loadMoreRow: { alignItems: 'flex-end', paddingRight: ROW_PAD_X, paddingVertical: 10 },
  loadMore: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
});
