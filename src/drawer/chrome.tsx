/**
 * The drawer's shared chrome, composed from the row geometry: the borderless search field, the section
 * label, the date divider, the nav row and the load-more affordance (apps/desktop/src/app/chat/sidebar/
 * chrome.tsx, load-more-row.tsx, app/shell/sidebar-label.tsx, components/ui/search-field.tsx).
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { Dither } from '../ui/Dither.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { DisclosureCaret } from '../ui/motion.tsx';
import { useTokens } from '../ui/tokens.ts';
import { tick } from '../ui/haptics.ts';
import { ROW_MIN_H, ROW_PAD_X } from './rowGeometry.ts';

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
      <Codicon name="search" size={16} color={t.uiTextTertiary} />
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
          <Codicon name="close" size={16} color={t.uiTextTertiary} />
        </Pressable>
      ) : null}
    </View>
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
      {onToggle ? <DisclosureCaret open={open ?? true} size={14} color={t.uiTextTertiary} /> : null}
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
      <DisclosureCaret open={open} size={14} color={t.uiTextTertiary} />
      <View style={[styles.rule, { backgroundColor: t.uiStrokeTertiary }]} />
    </Pressable>
  );
}

/**
 * A nav row (the desktop's `SidebarMenuButton`): a glyph at 80%, medium secondary text, the control-hover
 * wash while pressed. Parity deviation (touch): 48dp with a 20 dp glyph and a 17pt label, the size of a
 * phone app's primary drawer destinations.
 */
export function NavRow({ label, icon, onPress }: { label: string; icon: CodiconName; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.nav, { borderRadius: t.radius.md, backgroundColor: pressed ? t.uiControlHoverBackground : 'transparent' }]}
    >
      <View style={styles.navGlyph}>
        <Codicon name={icon} size={20} color={t.uiTextSecondary} />
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
        {loading ? <GlyphSpinner size={12} color={t.uiTextTertiary} label={label} /> : <Codicon name="ellipsis" size={16} color={t.uiTextTertiary} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2, minHeight: ROW_MIN_H },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  clear: { alignItems: 'center', justifyContent: 'center', width: 24, height: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 40, paddingTop: 14, paddingBottom: 6, paddingLeft: ROW_PAD_X, paddingRight: 12 },
  sectionLabel: { fontSize: 12, lineHeight: 14, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase', flexShrink: 1 },
  meta: { fontSize: 13, fontWeight: '500' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34, paddingHorizontal: ROW_PAD_X, paddingTop: 12, paddingBottom: 4 },
  dividerLabel: { fontSize: 11.5, lineHeight: 14, fontWeight: '600', letterSpacing: 1.1, textTransform: 'uppercase' },
  rule: { flex: 1, minWidth: 16, height: StyleSheet.hairlineWidth },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48, paddingHorizontal: ROW_PAD_X },
  navGlyph: { width: 22, alignItems: 'center', opacity: 0.8 },
  navLabel: { fontSize: 17, lineHeight: 22, fontWeight: '500', flexShrink: 1 },
  loadMoreRow: { alignItems: 'flex-end', paddingRight: ROW_PAD_X, paddingVertical: 10 },
  loadMore: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
