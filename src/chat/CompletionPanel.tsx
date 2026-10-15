/**
 * The shell both completion sheets share (desktop app/chat/composer/
 * trigger-popover.tsx): a panel docked on the composer's top edge with grouped
 * rows - icon, name, one clipped line of description.
 *
 * It lives in the chat's own tree rather than a Modal so the composer keeps
 * focus and the keyboard while the list filters as you type. The scrim covers
 * only the transcript above the panel, never the composer, and paints nothing.
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { useTokens, type Tokens } from '../ui/tokens.ts';

/** desktop reference-kinds.ts: the glyph each kind of reference draws */
const KIND_GLYPH: Record<string, CodiconName> = {
  file: 'file',
  folder: 'folder',
  url: 'globe',
  image: 'file-media',
  tool: 'tools',
  git: 'git-branch',
  diff: 'diff',
  staged: 'diff-added',
  command: 'terminal',
  skill: 'zap',
  simple: 'symbol-misc',
};

/** desktop styles.css `[data-ref]`; the accent-secondary and warm seeds have no token yet, so those kinds share the accent mix */
export function refColor(t: Tokens, kind: string): string {
  switch (kind) {
    case 'file':
    case 'folder':
    case 'git':
    case 'diff':
    case 'staged':
      return t.uiTextSecondary;
    default:
      return mixPct(t.uiAccent, 0.82, t.dtForeground);
  }
}

export function Panel({ bottom, maxHeight, onDismiss, header, children }: { bottom: number; maxHeight: number; onDismiss: () => void; header?: ReactNode; children: ReactNode }) {
  const t = useTokens();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[styles.scrim, { bottom }]} onPress={onDismiss} accessibilityLabel="Close suggestions" />
      <View
        style={[
          styles.panel,
          { bottom, maxHeight, backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: t.uiStrokePrimary }]} />
        {header}
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

export function GroupHeader({ label }: { label: string }) {
  const t = useTokens();
  return (
    <Text style={[styles.group, { color: t.uiTextTertiary }]} numberOfLines={1}>
      {label.toUpperCase()}
    </Text>
  );
}

export function Row({
  kind,
  title,
  meta,
  onPress,
  trailing,
}: {
  kind: string;
  title: string;
  meta: string;
  onPress: () => void;
  trailing?: ReactNode;
}) {
  const t = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.uiControlActiveBackground }]}
    >
      <View style={styles.glyph}>
        <Codicon name={KIND_GLYPH[kind] ?? 'symbol-misc'} size={14} color={refColor(t, kind)} />
      </View>
      <Text style={[styles.title, { color: t.uiTextPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      {meta ? (
        <Text style={[styles.meta, { color: t.uiTextTertiary }]} numberOfLines={1}>
          {meta}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {trailing}
    </Pressable>
  );
}

export function Empty({ loading, title, hint }: { loading: boolean; title: string; hint?: ReactNode }) {
  const t = useTokens();
  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="small" color={t.uiTextTertiary} />
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={{ color: t.uiTextTertiary, fontSize: 12 }}>{title}</Text>
      {hint}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  panel: { position: 'absolute', left: 0, right: 0, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, paddingTop: 6, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
  list: { paddingHorizontal: 4, paddingBottom: 6 },
  // desktop GROUP_HEADER_CLASS: 0.625rem, semibold, tracking-wider
  group: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 8, borderRadius: 6 },
  glyph: { width: 16, alignItems: 'center' },
  title: { flexShrink: 0, maxWidth: '58%', fontSize: 13, fontWeight: '500' },
  meta: { flex: 1, minWidth: 0, fontSize: 12 },
  empty: { paddingHorizontal: 12, paddingVertical: 14, alignItems: 'center', gap: 4 },
});
