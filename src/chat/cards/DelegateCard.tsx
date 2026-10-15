/**
 * A `delegate_task` call as the fan-out it is: one row per delegated child, the
 * goal and model on the first line and the child's latest relayed activity on
 * the second. The row joins the call (the goals it dispatched, how each child
 * ended) with the session's live subagents, so a delegation reads like the
 * several agents it is. Never folded into a run summary. The desktop's reel of
 * activity lines is one ticking line here, by the transcript decision that
 * dropped the live ticker. The fade mark sits on the goal line only, never on
 * the wrapper: opacity would open a stacking context around the activity line.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Codicon } from '../../ui/Codicon.tsx';
import { SCAFFOLD_OPACITY, useTokens } from '../../ui/tokens.ts';
import { AlertGlyph } from '../../ui/ToolIcon.tsx';
import { delegateRowsFromCall, isDelegateRowFailed, isDelegateRowLive, mergeDelegateRows, type DelegateRow } from '../delegate.ts';
import { formatDurationSeconds } from '../toolView.ts';
import type { ToolPart } from '../transcript.ts';
import { cardEnv, useLiveSubagents } from './env.ts';
import { GlyphSpinner } from '../../ui/loaders/GlyphSpinner.tsx';
import { ShimmerText } from '../../ui/ShimmerText.tsx';

/** the model's own name without its provider path */
const modelLabel = (model: string) => model.split('/').pop() || model;

function useElapsed(live: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!live) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds((Date.now() - started) / 1000), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return seconds;
}

function Glyph({ row }: { row: DelegateRow }) {
  const t = useTokens();
  if (isDelegateRowLive(row.status)) return <GlyphSpinner size={14} color={t.uiTextTertiary} style={styles.spinner} />;
  if (isDelegateRowFailed(row.status)) return <AlertGlyph size={14} color={t.dtDestructive} />;
  // parked, not watched: the children outlived the turn, so no spinner claims a liveness this view cannot back
  if (row.status === 'dispatched') return <View style={[styles.dot, { backgroundColor: t.uiTextTertiary }]} />;
  return <Codicon name="check" size={14} color={t.uiSuccess} />;
}

function Row({ row }: { row: DelegateRow }) {
  const t = useTokens();
  const live = isDelegateRowLive(row.status);
  const elapsed = useElapsed(live);
  const open = row.sessionId ? cardEnv().openSession : undefined;
  const meta = [row.model ? modelLabel(row.model) : '', !live && row.durationSeconds ? formatDurationSeconds(row.durationSeconds) : ''].filter(Boolean);
  const activity = row.activity[row.activity.length - 1];
  const label = live ? 'Running' : isDelegateRowFailed(row.status) ? 'Failed' : 'Done';

  return (
    <View style={[styles.row, { borderColor: t.uiStrokeTertiary, borderRadius: t.radius.xl }]}>
      <Pressable
        disabled={!open}
        onPress={() => open?.(row.sessionId!)}
        accessibilityRole={open ? 'button' : 'text'}
        accessibilityLabel={`${label}: ${row.goal}`}
        style={[styles.head, { opacity: SCAFFOLD_OPACITY }]}
      >
        <View style={styles.glyph}>
          <Glyph row={row} />
        </View>
        <Text numberOfLines={1} style={[styles.goal, { color: t.conversationScaffoldText, fontSize: t.type.tool, lineHeight: t.type.lineHeight }]}>
          {row.goal}
        </Text>
        {meta.length > 0 ? (
          <Text style={{ color: t.conversationScaffoldMeta, fontSize: t.type.tool * 0.85, fontVariant: ['tabular-nums'] }}>{meta.join(' · ')}</Text>
        ) : null}
        {live ? (
          <Text style={{ color: t.conversationScaffoldMeta, fontSize: t.type.tool * 0.85, fontVariant: ['tabular-nums'] }}>{formatDurationSeconds(elapsed)}</Text>
        ) : null}
        <Codicon name="agent" size={10} color={t.conversationScaffoldText} style={styles.agent} />
      </Pressable>
      {activity ? (
        live ? (
          <View style={[styles.activity, { opacity: SCAFFOLD_OPACITY }]}>
            <ShimmerText style={{ color: t.conversationScaffoldMeta, fontSize: t.type.tool, lineHeight: t.type.lineHeight }} fontSize={t.type.tool}>
              {activity}
            </ShimmerText>
          </View>
        ) : (
          <Text
            numberOfLines={1}
            style={[styles.activity, { color: t.conversationScaffoldMeta, opacity: SCAFFOLD_OPACITY, fontSize: t.type.tool, lineHeight: t.type.lineHeight }]}
          >
            {activity}
          </Text>
        )
      ) : null}
    </View>
  );
}

function DelegateCardImpl({ tool }: { tool: ToolPart }) {
  const live = useLiveSubagents();
  const result = tool.status === 'running' ? undefined : (tool.result ?? tool.resultText ?? '');
  const rows = useMemo(
    () => mergeDelegateRows(delegateRowsFromCall(tool.args, result, tool.id), live, tool.id),
    [tool.args, result, tool.id, live],
  );
  if (rows.length === 0) return null;
  return (
    <View style={styles.card}>
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </View>
  );
}

export const DelegateCard = memo(DelegateCardImpl);

const styles = StyleSheet.create({
  card: { gap: 6, maxWidth: '100%' },
  row: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  glyph: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  spinner: { transform: [{ scale: 0.6 }] },
  dot: { width: 6, height: 6, borderRadius: 3 },
  goal: { flexShrink: 1 },
  agent: { marginLeft: 'auto' },
  activity: { paddingLeft: 20 },
});
