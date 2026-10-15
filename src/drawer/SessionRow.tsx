/**
 * One session row (apps/desktop/src/app/chat/sidebar/session-row.tsx, the one-line form): the status
 * dot in its lead cell, the title, the compact age. A tap opens it, a long-press stands in for the
 * desktop's hover actions and opens the action sheet. The active row wears the row-active wash; a row
 * with a live turn wears the brighter title and the travelling arc.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionInfo } from '../chat/controller.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { tick } from '../ui/haptics.ts';
import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { RunningArc } from './RunningArc.tsx';
import { AGE_SIZE, BRANCH_INDENT, LABEL_LINE, LABEL_SIZE, ROW_GAP, ROW_MIN_H, ROW_PAD_X } from './rowGeometry.ts';
import { sessionAge, sessionTime } from './sessionDates.ts';
import { sessionTitle } from './sessionIndex.ts';
import { DOT_LABELS, hasLiveTurn, type DotState } from './sessionStatus.ts';
import { StatusDot } from './StatusDot.tsx';

type Props = {
  session: SessionInfo;
  active: boolean;
  state: DotState;
  branchStem?: string;
  /** epoch seconds, rounded to the minute so an unchanged row stays put between ticks */
  now: number;
  onOpen: (session: SessionInfo) => void;
  onActions: (session: SessionInfo) => void;
};

function SessionRowImpl({ session, active, state, branchStem, now, onOpen, onActions }: Props) {
  const t = useTokens();
  const live = hasLiveTurn(state);
  const title = sessionTitle(session);
  const age = sessionAge(sessionTime(session), now);
  const status = DOT_LABELS[state];

  return (
    <Pressable
      onPress={() => onOpen(session)}
      onLongPress={() => {
        tick();
        onActions(session);
      }}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${title}${status ? `, ${status}` : ''}, ${age}`}
      accessibilityHint="Long press for more actions"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.row,
        { borderRadius: t.radius.md, paddingLeft: ROW_PAD_X + (branchStem ? BRANCH_INDENT : 0) },
        (active || pressed) && { backgroundColor: active ? t.uiRowActiveBackground : t.uiRowHoverBackground },
      ]}
    >
      {state === 'working' ? <RunningArc /> : null}
      <StatusDot state={state} branchStem={branchStem} />
      {session.continuation_kind === 'compression' ? (
        <View accessible accessibilityLabel="Automatic continuation — this conversation was compressed and continued">
          <Codicon name="layers" size={14} color={t.uiTextQuaternary} />
        </View>
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.label, { color: live ? mixPct(t.dtForeground, 0.9, 'transparent') : t.uiTextSecondary }]}
      >
        {title}
      </Text>
      <Text style={[styles.age, { color: t.uiTextTertiary }]}>{age}</Text>
    </Pressable>
  );
}

// the callbacks are stable by contract, so the comparator reads only what changes what the row paints
export const SessionRow = memo(
  SessionRowImpl,
  (a, b) => a.session === b.session && a.active === b.active && a.state === b.state && a.branchStem === b.branchStem && a.now === b.now,
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP, minHeight: ROW_MIN_H, paddingRight: ROW_PAD_X },
  label: { flex: 1, minWidth: 0, fontSize: LABEL_SIZE, lineHeight: LABEL_LINE },
  age: { fontSize: AGE_SIZE, lineHeight: AGE_SIZE + 2, minWidth: 24, textAlign: 'right' },
});
