/**
 * The composer's model menu (desktop app/chat/composer/model-pill.tsx +
 * app/shell/model-catalog-menu.tsx): search, favorites, provider groups, the
 * current row's effort chip and check, and a per-model effort submenu that the
 * row's chevron opens in place of the desktop's hover flyout.
 *
 * The panel floats just above the composer, as the desktop's `side="top"`
 * popover does; it lives in the chat's own tree rather than a Modal so it rides
 * the keyboard with the composer. Favorites persist on the device under the
 * desktop's key.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { Codicon } from '../ui/Codicon.tsx';
import { useTokens, type Tokens } from '../ui/tokens.ts';
import type { ModelCatalog, ModelSwitchOutcome } from './controller.ts';
import { buildModelGroups, EFFORT_OPTIONS, effortShortLabel, type ModelRow, type ModelSelection } from './models.ts';

const FAVORITES_KEY = 'hermes.desktop.favorite-models';

function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void SecureStore.getItemAsync(FAVORITES_KEY)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (live && Array.isArray(parsed)) setFavorites(parsed.filter((k): k is string => typeof k === 'string'));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const toggle = useCallback((key: string) => {
    setFavorites((current) => {
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      void SecureStore.setItemAsync(FAVORITES_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);
  return [favorites, toggle] as const;
}

type Props = {
  visible: boolean;
  /** distance from the bottom of the chat area to the composer's top edge */
  bottom: number;
  /** room above the panel, for the list's height cap */
  available: number;
  catalog: ModelCatalog;
  current: ModelSelection | null;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (selection: ModelSelection, options?: { confirm?: boolean }) => Promise<ModelSwitchOutcome>;
  onEffort: (effort: string) => void;
};

export function ModelPicker({ visible, bottom, available, catalog, current, onClose, onRefresh, onSelect, onEffort }: Props) {
  const t = useTokens();
  const [favorites, toggleFavorite] = useFavorites();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ModelRow | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setOptions(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const groups = useMemo(
    () => buildModelGroups(catalog.providers, { favorites, current, query }),
    [catalog.providers, favorites, current, query],
  );

  const choose = async (row: ModelRow, effort?: string) => {
    onClose();
    const selection = { model: row.model, provider: row.provider, effort };
    const outcome = await onSelect(selection);
    if (outcome.kind === 'confirm') {
      Alert.alert('Switch model?', outcome.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => void onSelect(selection, { confirm: true }) },
      ]);
    }
  };

  const pickEffort = (row: ModelRow, effort: string) => {
    if (row.current) {
      onClose();
      onEffort(effort);
    } else {
      void choose(row, effort);
    }
  };

  if (!visible) return null;
  // search, separators, footer and padding take ~100 of the panel
  const maxListHeight = Math.max(120, Math.min(available * 0.75, available - 110));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close model menu" />
      <View
        style={[
          styles.panel,
          {
            bottom: bottom + 8,
            backgroundColor: t.uiBgElevated,
            borderColor: t.uiStrokeSecondary,
            borderRadius: t.radius.lg,
          },
        ]}
        accessibilityViewIsModal
      >
        {options ? (
          <EffortMenu t={t} row={options} current={current} onBack={() => setOptions(null)} onPick={(effort) => pickEffort(options, effort)} />
        ) : (
          <>
            <View style={styles.search}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search models"
                placeholderTextColor={t.uiTextTertiary}
                style={[styles.searchInput, { color: t.uiTextPrimary }]}
                selectionColor={t.uiAccent}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search models"
              />
            </View>
            <View style={[styles.separator, { backgroundColor: t.uiStrokeTertiary }]} />
            <ScrollView style={{ maxHeight: maxListHeight }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
              {groups.length === 0 ? (
                <View style={styles.emptyList}>
                  {catalog.loading ? (
                    <ActivityIndicator size="small" color={t.uiTextTertiary} />
                  ) : (
                    <Text style={[styles.rowText, { color: t.uiTextTertiary }]}>
                      {catalog.error ? `Could not load models. ${catalog.error}` : query ? 'No models match.' : 'No models configured.'}
                    </Text>
                  )}
                </View>
              ) : (
                groups.map((group) => (
                  <View key={group.id}>
                    <View style={styles.groupLabel}>
                      <Text style={[styles.groupText, { color: t.uiTextSecondary }]} numberOfLines={1}>
                        {group.label.toUpperCase()}
                      </Text>
                      {group.detail ? <Badge t={t} text={group.detail} transform={false} /> : null}
                    </View>
                    {group.rows.map((row) => (
                      <ModelRowView
                        key={`${group.id}:${row.key}`}
                        t={t}
                        row={row}
                        effort={row.current ? (current?.effort ?? null) : null}
                        onPress={() => void choose(row)}
                        onStar={() => toggleFavorite(row.key)}
                        onOptions={row.reasoning ? () => setOptions(row) : null}
                      />
                    ))}
                  </View>
                ))
              )}
            </ScrollView>
            <View style={[styles.separator, { backgroundColor: t.uiStrokeTertiary }]} />
            <FooterRow t={t} icon={<Codicon name="sync" size={12} color={t.uiTextTertiary} />} label="Refresh models" busy={catalog.loading} onPress={onRefresh} />
          </>
        )}
      </View>
    </View>
  );
}

function Badge({ t, text, outline = false, transform = true }: { t: Tokens; text: string; outline?: boolean; transform?: boolean }) {
  return (
    <View
      style={[
        styles.badge,
        outline ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.uiStrokeSecondary } : { backgroundColor: t.uiBgTertiary },
      ]}
    >
      <Text style={[styles.badgeText, { color: t.uiTextTertiary }, transform ? styles.badgeUpper : null]} numberOfLines={1}>
        {transform ? text.toUpperCase() : text}
      </Text>
    </View>
  );
}

function ModelRowView({
  t,
  row,
  effort,
  onPress,
  onStar,
  onOptions,
}: {
  t: Tokens;
  row: ModelRow;
  effort: string | null;
  onPress: () => void;
  onStar: () => void;
  onOptions: (() => void) | null;
}) {
  const effortLabel = effortShortLabel(effort);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: row.current }}
      accessibilityLabel={`${row.name}${row.tag ? ` ${row.tag}` : ''}, ${row.providerName}`}
      style={({ pressed }) => [styles.row, (row.current || pressed) && { backgroundColor: t.uiControlActiveBackground }]}
    >
      <Pressable onPress={onStar} hitSlop={8} accessibilityRole="button" accessibilityLabel={row.favorite ? 'Remove from favorites' : 'Add to favorites'} style={styles.star}>
        <Codicon name={row.favorite ? 'star-full' : 'star-empty'} size={12} color={row.favorite ? t.uiTextSecondary : t.uiTextQuaternary} />
      </Pressable>
      <View style={styles.nameGroup}>
        <Text style={[styles.rowText, { color: row.current ? t.uiTextPrimary : t.uiTextSecondary, flexShrink: 1 }]} numberOfLines={1}>
          {row.name}
        </Text>
        {row.tag ? <Badge t={t} text={row.tag} /> : null}
      </View>
      {effortLabel ? <Badge t={t} text={effortLabel} outline /> : null}
      {row.current ? <Codicon name="check" size={12} color={t.uiTextPrimary} /> : null}
      {onOptions ? (
        <Pressable onPress={onOptions} hitSlop={{ top: 8, bottom: 8, left: 6, right: 10 }} accessibilityRole="button" accessibilityLabel={`${row.name} options`}>
          <Codicon name="chevron-right" size={16} color={t.uiTextTertiary} />
        </Pressable>
      ) : (
        <View style={{ width: 16 }} />
      )}
    </Pressable>
  );
}

function EffortMenu({
  t,
  row,
  current,
  onBack,
  onPick,
}: {
  t: Tokens;
  row: ModelRow;
  current: ModelSelection | null;
  onBack: () => void;
  onPick: (effort: string) => void;
}) {
  const active = row.current ? (current?.effort ?? '').toLowerCase() : '';
  const choices = [{ value: 'none', label: 'Thinking off' }, ...EFFORT_OPTIONS];
  return (
    <View>
      <Pressable onPress={onBack} style={styles.row} accessibilityRole="button" accessibilityLabel="Back to models">
        <Codicon name="chevron-left" size={16} color={t.uiTextTertiary} />
        <Text style={[styles.rowText, { color: t.uiTextPrimary, flex: 1 }]} numberOfLines={1}>
          {row.name}
        </Text>
        {row.tag ? <Badge t={t} text={row.tag} /> : null}
      </Pressable>
      <View style={[styles.separator, { backgroundColor: t.uiStrokeTertiary }]} />
      <Text style={[styles.sectionLabel, { color: t.uiTextSecondary }]}>EFFORT</Text>
      {choices.map((choice) => (
        <Pressable
          key={choice.value}
          onPress={() => onPick(choice.value)}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: active === choice.value }}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.uiControlActiveBackground }]}
        >
          <Text style={[styles.rowText, { color: active === choice.value ? t.uiTextPrimary : t.uiTextSecondary, flex: 1 }]}>{choice.label}</Text>
          {active === choice.value ? <Codicon name="check" size={12} color={t.uiTextPrimary} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

function FooterRow({ t, icon, label, busy, onPress }: { t: Tokens; icon: React.ReactNode; label: string; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="menuitem"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.uiControlActiveBackground }]}
    >
      {busy ? <ActivityIndicator size="small" color={t.uiTextTertiary} style={{ width: 12, transform: [{ scale: 0.6 }] }} /> : icon}
      <Text style={[styles.rowText, { color: t.uiTextTertiary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderWidth: 1,
    paddingVertical: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  search: { paddingHorizontal: 10, paddingVertical: 6 },
  searchInput: { fontSize: 13, paddingVertical: 4, paddingHorizontal: 0 },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: 4 },
  list: { paddingVertical: 2 },
  emptyList: { paddingHorizontal: 10, paddingVertical: 14, alignItems: 'center' },
  groupLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 3 },
  groupText: { flex: 1, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  sectionLabel: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2, fontSize: 10, fontWeight: '500', letterSpacing: 0.25 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, paddingHorizontal: 10, paddingVertical: 6 },
  rowText: { fontSize: 13 },
  star: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', marginHorizontal: -2 },
  nameGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 },
  badgeText: { fontSize: 9.6, fontWeight: '500', lineHeight: 11 },
  badgeUpper: { letterSpacing: 0.24 },
});
