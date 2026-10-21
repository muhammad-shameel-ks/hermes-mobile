/**
 * The board's pickers and its bulk bar: the board switcher with "New board…" (desktop `board-switcher.tsx`,
 * name and slug only), the filter sheet (desktop `FilterMenu`: profile, tenant, archived, Running grouped by
 * profile) and the floating selection bar (desktop `SelectionBar`: move, assign, archive, delete).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Codicon } from '../../ui/Codicon.tsx';
import { mixPct } from '../../ui/color.ts';
import { GlyphSpinner } from '../../ui/loaders/GlyphSpinner.tsx';
import { tick } from '../../ui/haptics.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { MONO, useTokens } from '../../ui/tokens.ts';
import { slugify } from '../model.ts';
import { K } from '../text.ts';
import type { BoardMeta } from '../types.ts';
import { Avatar, FieldLabel } from '../ui.tsx';

function Row({ label, detail, checked, lead, onPress }: { label: string; detail?: string; checked?: boolean; lead?: ReactNode; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: checked }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.uiRowActiveBackground }]}
    >
      {lead ? <View style={styles.lead}>{lead}</View> : null}
      <Text numberOfLines={1} style={[styles.rowLabel, { color: t.uiTextPrimary }]}>
        {label}
      </Text>
      {detail ? <Text style={[styles.rowDetail, { color: t.uiTextQuaternary }]}>{detail}</Text> : null}
      {checked ? <Codicon name="check" size={14} color={t.uiTextSecondary} /> : null}
    </Pressable>
  );
}

export function BoardSheet({
  visible,
  boards,
  current,
  onSelect,
  onCreate,
  onClose,
}: {
  visible: boolean;
  /** null while the list loads */
  boards: { boards: BoardMeta[]; current: string } | null;
  /** the selected slug ('' = the server's current) */
  current: string;
  onSelect: (slug: string) => void;
  /** resolves to an error message, or null once the board exists */
  onCreate: (slug: string, name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const t = useTokens();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = slugify(name);
  const selected = current || boards?.current || '';

  useEffect(() => {
    if (!visible) {
      setAdding(false);
      setName('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const create = async () => {
    if (!slug || busy) return;
    setBusy(true);
    setError(null);
    const problem = await onCreate(slug, name.trim());
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose}>
      <Text style={[styles.title, { color: t.uiTextPrimary }]}>{adding ? K.newBoard : K.switchBoard}</Text>
      {adding ? (
        <View style={styles.form}>
          <TextInput
            autoFocus
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void create()}
            editable={!busy}
            placeholder={K.boardNamePlaceholder}
            placeholderTextColor={t.uiTextQuaternary}
            returnKeyType="done"
            accessibilityLabel={K.boardNamePlaceholder}
            style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
          />
          {slug ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11, fontFamily: MONO, marginTop: 6 }}>{K.slug(slug)}</Text> : null}
          {error ? <Text style={{ color: t.dtDestructive, fontSize: 12, marginTop: 6 }}>{error}</Text> : null}
          <View style={styles.buttons}>
            <Pressable onPress={() => setAdding(false)} disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: t.uiStrokePrimary, borderRadius: t.radius['3xl'] }]}>
              <Text style={{ color: t.uiTextPrimary, fontSize: 13 }}>{K.cancel}</Text>
            </Pressable>
            <Pressable
              onPress={() => void create()}
              disabled={busy || !slug}
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: t.dtPrimarySolid, borderColor: t.dtPrimarySolid, borderRadius: t.radius['3xl'], opacity: busy || !slug ? 0.5 : 1 }]}
            >
              <Text style={{ color: t.dtPrimarySolidForeground, fontSize: 13, fontWeight: '600' }}>{K.createBoard}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <ScrollView style={styles.list}>
          {boards ? (
            boards.boards.map((board) => (
              <Row
                key={board.slug}
                label={board.name || board.slug}
                detail={typeof board.total === 'number' ? String(board.total) : undefined}
                checked={board.slug === selected}
                lead={<Codicon name="project" size={14} color={t.uiTextTertiary} />}
                onPress={() => {
                  tick();
                  onClose();
                  // the server's current board is the bare selection, as the desktop stores it
                  onSelect(board.slug === boards.current ? '' : board.slug);
                }}
              />
            ))
          ) : (
            <View style={styles.loading}>
              <GlyphSpinner size={14} color={t.uiTextTertiary} />
            </View>
          )}
          <Row label={K.newBoardDots} lead={<Codicon name="add" size={14} color={t.uiTextTertiary} />} onPress={() => setAdding(true)} />
        </ScrollView>
      )}
    </Sheet>
  );
}

export function FilterSheet({
  visible,
  assignees,
  tenants,
  assignee,
  tenant,
  archived,
  groupRunning,
  onAssignee,
  onTenant,
  onArchived,
  onGroupRunning,
  onClose,
}: {
  visible: boolean;
  assignees: readonly string[];
  tenants: readonly string[];
  assignee: string;
  tenant: string;
  archived: boolean;
  groupRunning: boolean;
  onAssignee: (name: string) => void;
  onTenant: (name: string) => void;
  onArchived: (on: boolean) => void;
  onGroupRunning: (on: boolean) => void;
  onClose: () => void;
}) {
  const t = useTokens();
  const toggle = (label: string, value: boolean, onChange: (on: boolean) => void) => (
    <View style={styles.toggle}>
      <Text style={[styles.rowLabel, { color: t.uiTextPrimary }]}>{label}</Text>
      <Switch
        value={value}
        accessibilityLabel={label}
        onValueChange={(on) => {
          tick();
          onChange(on);
        }}
        trackColor={{ false: t.uiBgQuaternary, true: t.uiAccent }}
      />
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: t.uiTextPrimary }]}>{K.filters}</Text>
      <ScrollView style={styles.list}>
        <View style={styles.label}>
          <FieldLabel>{K.assignee}</FieldLabel>
        </View>
        <Row label={K.allProfiles} checked={!assignee} onPress={() => onAssignee('')} />
        {assignees.map((name) => (
          <Row key={name} label={name} checked={assignee === name} lead={<Avatar name={name} size={18} />} onPress={() => onAssignee(name)} />
        ))}
        {tenants.length > 0 ? (
          <>
            <View style={styles.label}>
              <FieldLabel>{K.metaTenant}</FieldLabel>
            </View>
            <Row label={K.allTenants} checked={!tenant} onPress={() => onTenant('')} />
            {tenants.map((name) => (
              <Row key={name} label={name} checked={tenant === name} onPress={() => onTenant(name)} />
            ))}
          </>
        ) : null}
        <View style={[styles.rule, { backgroundColor: t.uiStrokeTertiary }]} />
        {toggle(K.showArchived, archived, onArchived)}
        {toggle(K.groupRunning, groupRunning, onGroupRunning)}
      </ScrollView>
    </Sheet>
  );
}

/** the bulk bar over the bottom of the board while cards are selected */
export function SelectionBar({
  count,
  busy,
  bottomInset,
  onMove,
  onAssign,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  busy: boolean;
  bottomInset: number;
  onMove: () => void;
  onAssign: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useTokens();
  const action = (label: string, onPress: () => void, destructive = false, caret = false) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.barAction, { borderRadius: t.radius.sm }, pressed && { backgroundColor: t.uiControlHoverBackground }, busy && { opacity: 0.5 }]}
    >
      <Text style={{ color: destructive ? t.dtDestructive : t.uiTextPrimary, fontSize: 13, fontWeight: '500' }}>{label}</Text>
      {caret ? <Codicon name="chevron-up" size={10} color={t.uiTextTertiary} /> : null}
    </Pressable>
  );
  return (
    <View pointerEvents="box-none" style={[styles.barWrap, { bottom: bottomInset + 12 }]}>
      <View style={[styles.bar, { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.lg }]}>
        <View style={[styles.count, { backgroundColor: mixPct(t.dtComposerRing, 0.16, 'transparent'), borderRadius: t.radius.full }]}>
          {busy ? <GlyphSpinner size={11} color={t.uiTextSecondary} /> : null}
          <Text style={{ color: t.uiTextSecondary, fontSize: 12, fontVariant: ['tabular-nums'] }}>{K.nSelected(count)}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barActions}>
          {action(K.moveToShort, onMove, false, true)}
          {action(K.assign, onAssign, false, true)}
          {action(K.archive, onArchive)}
          {action(K.delete, onDelete, true)}
        </ScrollView>
        <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear selection" style={styles.clear}>
          <Codicon name="close" size={14} color={t.uiTextTertiary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '600', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  list: { maxHeight: 480 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 20 },
  lead: { width: 20, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: 15 },
  rowDetail: { fontSize: 12, fontVariant: ['tabular-nums'] },
  label: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20, marginVertical: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 20 },
  loading: { alignItems: 'center', paddingVertical: 20 },
  form: { paddingHorizontal: 20, paddingBottom: 8 },
  input: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  button: { paddingHorizontal: 16, paddingVertical: 9, borderWidth: StyleSheet.hairlineWidth },
  barWrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5 },
  barActions: { alignItems: 'center', gap: 2 },
  barAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 10 },
  clear: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
});
