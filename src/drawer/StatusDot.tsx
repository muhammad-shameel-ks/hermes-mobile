/**
 * The session status dot (apps/desktop/src/app/chat/session-status-dot.tsx): the one primitive the
 * sessions list and the bot roster render, so a status never disagrees between them. Three colours and
 * one fill/hollow axis, none of it moving: filled means producing, hollow means open but quiet. The
 * motion a running row carries belongs to its arc.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { ROW_LEAD } from './rowGeometry.ts';
import { DOT_LABELS, type DotState } from './sessionStatus.ts';

/** tailwind amber-500: the one "act now" colour, a prompt is blocking the turn */
const AMBER = '#f59e0b';

function dotStyle(state: DotState, t: Tokens) {
  switch (state) {
    case 'needs-input':
      return { width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER };
    case 'working':
      return { width: 6, height: 6, borderRadius: 3, backgroundColor: t.uiAccent };
    case 'background':
      return { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: t.uiTextTertiary };
    case 'unread':
      return { width: 6, height: 6, borderRadius: 3, backgroundColor: t.uiSuccess };
    case 'draft':
      return { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: t.uiTextQuaternary };
    case 'idle':
      return { width: 4, height: 4, borderRadius: 2, backgroundColor: t.uiTextQuaternary };
  }
}

/** the dot in its fixed lead cell, so every label starts on one left edge whatever the state */
function StatusDotImpl({ state, branchStem }: { state: DotState; branchStem?: string }) {
  const t = useTokens();
  const label = DOT_LABELS[state];
  return (
    <View style={styles.lead}>
      {branchStem ? (
        <Text aria-hidden allowFontScaling={false} style={[styles.stem, { color: t.uiTextQuaternary, fontFamily: MONO }]}>
          {branchStem.trim()}
        </Text>
      ) : null}
      <View accessible={label !== undefined} accessibilityRole={label ? 'image' : undefined} accessibilityLabel={label} style={dotStyle(state, t)} />
    </View>
  );
}

export const StatusDot = memo(StatusDotImpl);

const styles = StyleSheet.create({
  lead: { minWidth: ROW_LEAD, height: ROW_LEAD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  stem: { fontSize: 12, lineHeight: 12 },
});
