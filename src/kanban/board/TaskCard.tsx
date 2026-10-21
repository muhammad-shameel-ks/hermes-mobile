/**
 * One card (desktop `board.tsx` `Card` + `CardFooter`): the lane's tone on the left edge, the title, the
 * latest summary or body, and a footer saying who is on it and how it is going. The border arc travels
 * only while an agent is actually working the card (amber and slow once its heartbeat is gone); a queued
 * card names the agent coming for it instead. Tap opens; hold lifts it to move (see `drag.tsx`).
 */

import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { RunningArc } from '../../drawer/RunningArc.tsx';
import { Codicon, type CodiconName } from '../../ui/Codicon.tsx';
import { mixPct } from '../../ui/color.ts';
import { MONO, useTokens } from '../../ui/tokens.ts';
import { ago, arcState, attachedAgent, laneTone, SEVERITY_TONE, shortId, STALE_TONE, wontRun } from '../model.ts';
import { K } from '../text.ts';
import type { KanbanTask } from '../types.ts';
import { Avatar, PriorityGlyph, RunClock } from '../ui.tsx';
import { useCardGesture, type DragApi } from './drag.tsx';

/** the desktop arc's pace (`kanban.css`): a brisk sweep, an amber crawl when the heartbeat is gone */
const ARC_MS = 2200;
const STALE_ARC_MS = 6000;

export type CardContext = {
  /** `kanban.default_assignee`: who an unassigned Ready card goes to ('' = nobody) */
  fallback: string;
  /** the specifier that rewrites Triage cards */
  orchestrator: string;
  nowSeconds: number;
};

function Meta({ icon, color, children }: { icon: CodiconName; color: string; children: ReactNode }) {
  return (
    <View style={styles.meta}>
      <Codicon name={icon} size={10} color={color} />
      <Text style={[styles.metaText, { color }]}>{children}</Text>
    </View>
  );
}

/** the card's face, shared by the list and the lifted ghost */
export const CardFace = memo(function CardFace({ task, context, selected, still }: { task: KanbanTask; context: CardContext; selected: boolean; still?: boolean }) {
  const t = useTokens();
  const tone = laneTone(task.status, t);
  const arc = arcState(task, context.fallback, context.nowSeconds);
  const attached = attachedAgent(task, context.fallback, context.orchestrator);
  const summary = task.latest_summary || task.body;
  const links = task.link_counts ? task.link_counts.parents + task.link_counts.children : 0;
  const unassignedReady = task.status === 'ready' && !task.assignee;
  const created = ago(task.created_at, context.nowSeconds);
  const quiet = t.uiTextQuaternary;
  const tertiary = t.uiTextTertiary;

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: t.radius.md,
          borderColor: selected ? t.dtComposerRing : t.uiStrokeTertiary,
          borderLeftColor: tone,
          backgroundColor: selected ? mixPct(t.dtComposerRing, 0.07, t.uiBgElevated) : t.uiBgElevated,
        },
      ]}
    >
      {(arc === 'running' || arc === 'stale') && !selected && !still ? (
        <RunningArc color={arc === 'stale' ? STALE_TONE : tone} durationMs={arc === 'stale' ? STALE_ARC_MS : ARC_MS} />
      ) : null}
      <Text numberOfLines={2} style={[styles.title, { color: t.uiTextPrimary }, selected && styles.titleChecked]}>
        {task.title || task.id}
      </Text>
      {summary ? (
        <Text numberOfLines={2} style={[styles.summary, { color: tertiary }]}>
          {summary}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <View style={styles.footerLead}>
          {arc === 'queued' && attached ? (
            <View style={styles.attached}>
              <Avatar name={attached} size={18} />
              <Text numberOfLines={1} style={[styles.attachedText, { color: tone }]}>
                {task.assignee ? attached : `→ ${attached}`}
              </Text>
            </View>
          ) : task.assignee ? (
            <Avatar name={task.assignee} size={18} />
          ) : null}
          {arc === 'running' ? <RunClock task={task} /> : null}
          {arc === 'stale' ? <Text style={[styles.flag, { color: STALE_TONE }]}>{K.noHeartbeat}</Text> : null}
          {task.status === 'blocked' && task.block_kind ? (
            <Meta icon="debug-breakpoint-data-unverified" color={SEVERITY_TONE.error}>
              {task.block_kind}
            </Meta>
          ) : null}
          {wontRun(task, context.fallback) ? (
            <Meta icon="debug-disconnect" color={STALE_TONE}>
              {K.wontRun}
            </Meta>
          ) : null}
        </View>
        <View style={styles.footerTrail}>
          {typeof task.priority === 'number' && task.priority > 0 ? <PriorityGlyph priority={task.priority} size={10} /> : null}
          {task.progress && task.progress.total > 0 ? <Meta icon="checklist" color={tertiary}>{`${task.progress.done}/${task.progress.total}`}</Meta> : null}
          {task.comment_count ? <Meta icon="comment" color={tertiary}>{task.comment_count}</Meta> : null}
          {links > 0 ? <Meta icon="references" color={tertiary}>{links}</Meta> : null}
          {task.warnings && task.warnings.count > 0 ? <Meta icon="warning" color={SEVERITY_TONE.error}>{task.warnings.count}</Meta> : null}
          {created && !task.assignee && !unassignedReady ? <Text style={[styles.metaText, { color: quiet }]}>{created}</Text> : null}
          <Text style={[styles.id, { color: quiet }]}>{shortId(task.id)}</Text>
        </View>
      </View>
      {selected ? (
        <View style={[styles.check, { backgroundColor: t.dtComposerRing }]}>
          <Codicon name="check" size={10} color={t.dtBackground} />
        </View>
      ) : null}
    </View>
  );
});

export const TaskCard = memo(function TaskCard({
  task,
  context,
  selected,
  selecting,
  lifted,
  api,
  onTap,
  onMenu,
}: {
  task: KanbanTask;
  context: CardContext;
  selected: boolean;
  /** taps toggle selection rather than open, and nothing lifts */
  selecting: boolean;
  /** this card is in the air: its slot dims */
  lifted: boolean;
  api: DragApi;
  onTap: (id: string) => void;
  /** the card's actions, which a screen reader reaches as its long press since it cannot drag */
  onMenu: (id: string) => void;
}) {
  const gesture = useCardGesture(api, task.id, !selecting, onTap);
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="button"
        accessibilityLabel={task.title || task.id}
        accessibilityState={{ selected }}
        accessibilityActions={CARD_ACTIONS}
        onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'longpress' ? onMenu(task.id) : onTap(task.id))}
        style={lifted ? styles.lifted : undefined}
      >
        <CardFace task={task} context={context} selected={selected} still={lifted} />
      </View>
    </GestureDetector>
  );
});

const CARD_ACTIONS = [{ name: 'activate' }, { name: 'longpress', label: 'Actions' }];

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 2, paddingHorizontal: 12, paddingVertical: 11, gap: 7, overflow: 'hidden' },
  title: { fontSize: 14.5, lineHeight: 19, fontWeight: '500' },
  titleChecked: { paddingRight: 22 },
  summary: { fontSize: 12.5, lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4, minHeight: 18 },
  footerLead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  footerTrail: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  attached: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0 },
  attachedText: { fontSize: 11, fontWeight: '500', flexShrink: 1 },
  flag: { fontSize: 10.5, fontWeight: '500' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 10.5, fontVariant: ['tabular-nums'] },
  id: { fontFamily: MONO, fontSize: 10 },
  check: { position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lifted: { opacity: 0.35 },
});
