/**
 * The kanban surfaces' shared pieces (the desktop plugin's `ui.tsx`): the identity avatar, the status pill,
 * the priority glyph, the ticking run clock, the tinted callout, the section label, the lane and profile
 * pickers, and `useLive`, the React edge of a polled read.
 */

import { memo, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { profileColor } from '../bots/face.ts';
import { profileColorSoft } from '../drawer/profileGlyph.ts';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { useAppForeground } from '../ui/clock.ts';
import { mixPct } from '../ui/color.ts';
import { tick } from '../ui/haptics.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import type { LiveResource, LiveSnapshot } from './live.ts';
import { elapsedLabel, isLockedTarget, laneTone, PRIORITY_TONE } from './model.ts';
import { K, laneLabel, lockedReason } from './text.ts';
import type { KanbanProfile, KanbanTask } from './types.ts';

/** a polled read, running while the calling screen is mounted and the app is in the foreground */
export function useLive<T>(resource: LiveResource<T>): LiveSnapshot<T> {
  const foreground = useAppForeground();
  useEffect(() => {
    if (!foreground) return;
    resource.start();
    return () => resource.stop();
  }, [resource, foreground]);
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
}

/** desktop `initials`: the first letters of the name's first two words */
function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s_\-./]+/)
    .filter(Boolean);
  return `${parts[0]?.[0] ?? '?'}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

/** desktop `Avatar`: the profile's identity hue as a soft fill with its initials; default and unnamed stay neutral */
export const Avatar = memo(function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  const t = useTokens();
  const color = profileColor(name);
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color ? profileColorSoft(color, 22) : t.uiBgQuaternary,
      }}
    >
      <Text allowFontScaling={false} style={{ color: color ?? t.uiTextSecondary, fontSize: Math.max(8, size * 0.45), fontWeight: '600' }}>
        {initials(name)}
      </Text>
    </View>
  );
});

/** desktop `StatusMenu` trigger: the lane's tone as a wash, its dot, label and a chevron */
export function StatusPill({ status, onPress }: { status: string; onPress?: () => void }) {
  const t = useTokens();
  const tone = laneTone(status, t);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${K.status}: ${laneLabel(status)}`}
      style={({ pressed }) => [styles.pill, { backgroundColor: mixPct(tone, 0.15, 'transparent'), borderRadius: t.radius.sm }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.pillLabel, { color: tone }]}>{laneLabel(status)}</Text>
      {onPress ? <Codicon name="chevron-down" size={11} color={tone} /> : null}
    </Pressable>
  );
}

/** desktop `PriorityGlyph`: an amber up-arrow and the number when raised, a muted bare number at 0 */
export function PriorityGlyph({ priority, size = 11 }: { priority: number; size?: number }) {
  const t = useTokens();
  if (priority <= 0) return <Text style={{ color: t.uiTextQuaternary, fontSize: size }}>{priority}</Text>;
  return (
    <View style={styles.inline}>
      <Codicon name="arrow-up" size={size} color={PRIORITY_TONE} />
      <Text style={{ color: PRIORITY_TONE, fontSize: size, fontVariant: ['tabular-nums'] }}>{priority}</Text>
    </View>
  );
}

const RUN_CLOCK_MS = 5000;

/** "working · 34s", ticking every 5 s; isolated so only this text re-renders */
export const RunClock = memo(function RunClock({ task, size = 10 }: { task: KanbanTask; size?: number }) {
  const t = useTokens();
  const start = task.current_run_started_at ?? task.started_at;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!start) return;
    const id = setInterval(() => setNow(Date.now()), RUN_CLOCK_MS);
    return () => clearInterval(id);
  }, [start]);
  if (!start) return null;
  return (
    <Text numberOfLines={1} style={{ color: laneTone('running', t), fontSize: size, fontWeight: '500' }}>
      {K.working} · {elapsedLabel(now - start * 1000)}
    </Text>
  );
});

/** desktop `Callout`: a tone-washed panel with a matching left rule and a tone-coloured title */
export function Callout({ tone, title, icon = 'warning', children }: { tone: string; title: string; icon?: CodiconName; children?: ReactNode }) {
  return (
    <View style={[styles.callout, { backgroundColor: mixPct(tone, 0.07, 'transparent'), borderLeftColor: tone }]}>
      <View style={styles.calloutTitle}>
        <Codicon name={icon} size={13} color={tone} style={styles.calloutGlyph} />
        <Text style={{ color: tone, fontSize: 13, fontWeight: '500', flex: 1 }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** desktop `FIELD_LABEL` + `Section`: the small uppercase label, an optional trailing action, then the body */
export function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <FieldLabel>{label}</FieldLabel>
        {action}
      </View>
      {children}
    </View>
  );
}

export function FieldLabel({ children }: { children: string }) {
  const t = useTokens();
  return <Text style={[styles.fieldLabel, { color: t.uiTextQuaternary }]}>{children}</Text>;
}

/**
 * The status picker (desktop `StatusMenu` and the card's "Move to" items): every lane with its dot, the
 * current one checked, the dispatcher's lanes shown but closed with the reason they are.
 */
export function LaneSheet({
  visible,
  title,
  columns,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  columns: readonly string[];
  /** checked and inert; null for a pick over several cards */
  current: string | null;
  onPick: (lane: string) => void;
  onClose: () => void;
}) {
  const t = useTokens();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[styles.sheetTitle, { color: t.uiTextPrimary }]}>{title}</Text>
      <ScrollView style={styles.sheetList}>
        {columns.map((name) => {
          const here = name === current;
          const locked = !here && isLockedTarget(name);
          return (
            <Pressable
              key={name}
              disabled={here || locked}
              onPress={() => {
                tick();
                onClose();
                onPick(name);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: here, disabled: here || locked }}
              style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: t.uiRowActiveBackground }]}
            >
              <View style={[styles.dot, styles.rowDot, { backgroundColor: laneTone(name, t), opacity: locked ? 0.45 : 1 }]} />
              <View style={styles.sheetRowText}>
                <Text style={{ color: locked ? t.uiTextTertiary : t.uiTextPrimary, fontSize: 15 }}>{laneLabel(name)}</Text>
                {locked ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11.5, marginTop: 2 }}>{lockedReason(name)}</Text> : null}
              </View>
              {here ? <Codicon name="check" size={14} color={t.uiTextSecondary} /> : locked ? <Codicon name="lock" size={12} color={t.uiTextQuaternary} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

export type ProfileChoice = { key: string; label: string; profile: string | null; detail?: string };

/** a profile picker: the roster's faces, the current one checked, plus whatever extra rows the caller needs */
export function ProfileSheet({
  visible,
  title,
  profiles,
  current,
  leading = [],
  trailing = [],
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  profiles: readonly KanbanProfile[];
  current: string | null;
  leading?: readonly ProfileChoice[];
  trailing?: readonly ProfileChoice[];
  onPick: (choice: ProfileChoice) => void;
  onClose: () => void;
}) {
  const t = useTokens();
  const rows: ProfileChoice[] = [...leading, ...profiles.map((p) => ({ key: `p:${p.name}`, label: p.name, profile: p.name })), ...trailing];
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[styles.sheetTitle, { color: t.uiTextPrimary }]}>{title}</Text>
      <ScrollView style={styles.sheetList}>
        {rows.map((row) => (
          <Pressable
            key={row.key}
            onPress={() => {
              tick();
              onClose();
              onPick(row);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: t.uiRowActiveBackground }]}
          >
            <View style={styles.rowLead}>{row.profile ? <Avatar name={row.profile} size={22} /> : <Codicon name="circle-slash" size={14} color={t.uiTextTertiary} />}</View>
            <View style={styles.sheetRowText}>
              <Text numberOfLines={1} style={{ color: t.uiTextPrimary, fontSize: 15 }}>
                {row.label}
              </Text>
              {row.detail ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11.5, marginTop: 2 }}>{row.detail}</Text> : null}
            </View>
            {row.profile !== null && row.profile === current ? <Codicon name="check" size={14} color={t.uiTextSecondary} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, minHeight: 26, alignSelf: 'flex-start' },
  pillLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  callout: { borderLeftWidth: 2, borderRadius: 6, padding: 10, gap: 8 },
  calloutTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  calloutGlyph: { marginTop: 2 },
  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 },
  fieldLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  sheetTitle: { fontSize: 15, fontWeight: '600', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  sheetList: { maxHeight: 460 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 20, paddingVertical: 8 },
  sheetRowText: { flex: 1, minWidth: 0 },
  rowDot: { width: 8, height: 8, borderRadius: 4 },
  rowLead: { width: 22, alignItems: 'center' },
});
