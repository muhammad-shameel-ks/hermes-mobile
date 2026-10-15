/**
 * The status stack: the dock above the composer holding the session's live rows
 * - goal, todo, subagents, background tasks, the retained todo snapshot and the
 * queue - ported from the desktop's composer/status-stack. One card in the
 * composer's own fill, rounded at the top and capped at 40% of the screen, with
 * a ridge handle that folds the whole stack away (the desktop's status drawer,
 * with its 260 ms lift and 200 ms fold).
 *
 * Billing, free-tier, shared-metrics, preview and the coding row are not ported
 * (issue "Transcript and composer parity on touch"); the stack ghosting when
 * the transcript is scrolled up is dropped with the hover that restored it.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { useTokens, type Tokens } from '../ui/tokens.ts';
import { formatElapsed } from './actionBar.ts';
import type { ChatController, ChatEntry } from './controller.ts';
import { QueuePanel, type QueueActions } from './QueuePanel.tsx';
import { BrailleSpinner, MicroButton, PendingGlyph, ROW_TEXT, StateDot, StatusRow, StatusSection } from './StatusRows.tsx';
import {
  groupLabel,
  groupStatusItems,
  hasRunningBackground,
  liveSubagents,
  retainedTodoItems,
  STATUS_COPY,
  statusItems,
  type StatusGroup,
  type StatusItem,
  type StatusState,
  type Subagent,
} from './statusStack.ts';

/** safety-net poll for processes that exit without an event (desktop BACKGROUND_POLL_MS) */
const BACKGROUND_POLL_MS = 5_000;
const SUBAGENT_POLL_MS = 5_000;
/** the composer dock's top padding in ChatScreen */
const DOCK_TOP = 6;

/** desktop drawer.css: lift 260 ms cubic-bezier(.16,1,.3,1), fold 200 ms cubic-bezier(.4,0,.2,1) after 70 ms */
const LIFT = { duration: 260, easing: Easing.bezier(0.16, 1, 0.3, 1) };
const FOLD = { duration: 200, easing: Easing.bezier(0.4, 0, 0.2, 1) };

const GROUP_ICON: Record<StatusGroup['type'], CodiconName> = { goal: 'target', todo: 'checklist', subagent: 'agent', background: 'server-process' };

export function StatusStack({ controller, entry, busy }: { controller: ChatController; entry: ChatEntry; busy: boolean }) {
  const t = useTokens();
  const { height } = useWindowDimensions();
  const key = entry.key;
  const { status, queue, hidden } = entry.stack;

  const items = statusItems(status);
  const groups = groupStatusItems(items);
  const retained = retainedTodoItems(status, busy);
  const hasQueue = queue.entries.length > 0;
  const running = hasRunningBackground(status);
  const liveSubs = liveSubagents(status).length > 0;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void controller.status.refreshProcesses(key), BACKGROUND_POLL_MS);
    return () => clearInterval(timer);
  }, [controller, key, running]);

  useEffect(() => {
    if (!liveSubs) return;
    const timer = setInterval(() => void controller.status.refreshSubagents(key), SUBAGENT_POLL_MS);
    return () => clearInterval(timer);
  }, [controller, key, liveSubs]);

  const actions: QueueActions = {
    remove: (id) => controller.queue.remove(key, id),
    beginEdit: (id) => controller.queue.beginEdit(key, id),
    saveEdit: (id, text) => controller.queue.saveEdit(key, id, text),
    cancelEdit: () => controller.queue.cancelEdit(key),
    sendNow: (id) => void controller.queue.sendNow(key, id),
    steerNow: (id) => void controller.queue.steerNow(key, id),
    resume: () => controller.queue.resume(key),
  };

  const present = groups.length > 0 || retained.length > 0 || hasQueue;
  if (!present) return null;

  return (
    <View style={[styles.wrap, hidden && styles.wrapFolded]}>
      <Drawer hidden={hidden}>
        <View style={[styles.card, { backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderTopLeftRadius: t.radius['2xl'], borderTopRightRadius: t.radius['2xl'] }]}>
          <ScrollView style={{ maxHeight: height * 0.4 }} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {groups.map((group) =>
              group.type === 'subagent' ? (
                <SubagentSection key="subagent" controller={controller} sessionKey={key} status={status} />
              ) : (
                <StatusGroupSection key={group.type} group={group} controller={controller} sessionKey={key} />
              ),
            )}
            {retained.length > 0 ? (
              <StatusSection
                label={STATUS_COPY.previousTodos(retained.filter((i) => i.todoStatus === 'completed').length, retained.length)}
                icon="checklist"
              >
                {retained.map((item, index) => (
                  <ItemRow key={item.id} item={item} historical last={index === retained.length - 1} />
                ))}
              </StatusSection>
            ) : null}
            <QueuePanel queue={queue} busy={busy} actions={actions} />
          </ScrollView>
        </View>
      </Drawer>
      <Handle t={t} hidden={hidden} onPress={() => controller.setStackHidden(key, !hidden)} />
    </View>
  );
}

/** the status drawer: content stays mounted while folded so a section's open or closed choice survives */
function Drawer({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const open = useSharedValue(hidden ? 0 : 1);
  const natural = useSharedValue(0);

  useEffect(() => {
    if (reduced) open.value = hidden ? 0 : 1;
    else open.value = hidden ? withDelay(70, withTiming(0, FOLD)) : withTiming(1, LIFT);
  }, [hidden, open, reduced]);

  const clip = useAnimatedStyle(() => ({ maxHeight: open.value >= 1 ? 100000 : natural.value * open.value }));
  const content = useAnimatedStyle(() => ({ opacity: interpolate(open.value, [0, 1], [0.078, 1]), transform: [{ translateY: interpolate(open.value, [0, 1], [8, 0]) }] }));

  return (
    <Animated.View style={[styles.clip, clip]} pointerEvents={hidden ? 'none' : 'auto'} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
      <Animated.View style={content} onLayout={(event) => (natural.value = event.nativeEvent.layout.height)}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

/** the ridge: a short grip straddling the card's top edge, at the desktop's 0.35 rest opacity */
function Handle({ t, hidden, onPress }: { t: Tokens; hidden: boolean; onPress: () => void }) {
  const label = hidden ? STATUS_COPY.showStack : STATUS_COPY.hideStack;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !hidden }} onPress={onPress} hitSlop={{ top: 6, bottom: 6, left: 12, right: 12 }} style={styles.handle}>
      <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: t.uiTextSecondary, opacity: 0.35 }} />
    </Pressable>
  );
}

function StatusGroupSection({ group, controller, sessionKey }: { group: StatusGroup; controller: ChatController; sessionKey: string }) {
  const t = useTokens();
  const runningTodo = group.type === 'todo' && group.items.some((item) => item.todoStatus === 'in_progress' && item.state === 'running');
  return (
    <StatusSection
      label={groupLabel(group)}
      icon={GROUP_ICON[group.type]}
      defaultCollapsed={group.type !== 'todo'}
      collapsedIndicator={runningTodo ? <BrailleSpinner color={t.uiTextTertiary} label={STATUS_COPY.running} /> : undefined}
    >
      {group.items.map((item, index) => (
        <ItemRow
          key={item.id}
          item={item}
          last={index === group.items.length - 1}
          onDismiss={group.type === 'background' ? () => controller.status.dismiss(sessionKey, item.id) : undefined}
          onStop={group.type === 'background' ? () => void controller.status.stopProcess(sessionKey, item.id) : undefined}
        />
      ))}
    </StatusSection>
  );
}

/** the left slot: a spinner while running, otherwise a status glyph, so every row's slot is filled and rows align */
function Leading({ item, historical, t }: { item: StatusItem; historical: boolean; t: Tokens }) {
  if (item.type === 'goal') {
    if (item.goalStatus === 'paused') return <Codicon name="debug-pause" size={12.8} color={mixPct(t.uiTextTertiary, 0.9, 'transparent')} />;
    if (item.goalStatus === 'done') return <Codicon name="pass-filled" size={12.8} color={t.uiSuccess} />;
    return <BrailleSpinner color={t.uiSuccess} label={STATUS_COPY.running} size={13.6} />;
  }
  if (item.todoStatus === 'pending' || (historical && item.todoStatus === 'in_progress')) return <PendingGlyph color={t.uiTextTertiary} />;
  if (item.todoStatus && item.todoStatus !== 'in_progress') {
    return item.todoStatus === 'completed' ? <Codicon name="pass-filled" size={12.8} color={t.uiSuccess} /> : <Codicon name="circle-slash" size={12.8} color={t.uiTextQuaternary} />;
  }
  if (item.state === 'running') return <BrailleSpinner color={t.uiTextTertiary} label={STATUS_COPY.running} size={13.6} />;
  return <StateDot color={item.state === 'failed' ? t.dtDestructive : t.uiSuccess} />;
}

function ItemRow({ item, historical = false, last, onDismiss, onStop }: { item: StatusItem; historical?: boolean; last: boolean; onDismiss?: () => void; onStop?: () => void }) {
  const t = useTokens();
  const failed = item.state === 'failed';
  const running = item.state === 'running';
  const action = item.type === 'background' ? (running ? onStop && { label: STATUS_COPY.stop, onDismiss: onStop } : onDismiss && { label: STATUS_COPY.dismiss, onDismiss }) : undefined;
  const settledTodo = item.todoStatus && item.todoStatus !== 'in_progress';
  const color = failed ? t.dtDestructive : settledTodo ? t.uiTextTertiary : t.uiTextPrimary;
  return (
    <StatusRow depth={item.depth} last={last} dismiss={action || undefined} leading={<Leading item={item} historical={historical} t={t} />}>
      <Text numberOfLines={1} style={[styles.rowText, { color }]}>
        {item.title}
      </Text>
      {item.type === 'goal' && item.currentTool ? (
        <Text numberOfLines={1} style={[styles.meta, { color: t.uiTextTertiary }]}>
          {item.currentTool}
        </Text>
      ) : null}
      {failed && typeof item.exitCode === 'number' && item.exitCode !== 0 ? (
        <View style={[styles.badge, { backgroundColor: mixPct(t.dtDestructive, 0.15, 'transparent'), borderRadius: t.radius.sm }]}>
          <Text style={[styles.badgeText, { color: t.dtDestructive }]}>{STATUS_COPY.exit(item.exitCode)}</Text>
        </View>
      ) : null}
    </StatusRow>
  );
}

/** seconds tick once a second while anything is live */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** a roster local to this session, never the global agents list */
function SubagentSection({ controller, sessionKey, status }: { controller: ChatController; sessionKey: string; status: StatusState }) {
  const t = useTokens();
  const { height } = useWindowDimensions();
  const live = liveSubagents(status);
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(live.length > 0);
  if (live.length === 0) return null;
  const running = live.some((item) => item.status === 'running');
  const detail = live.find((item) => item.id === selected);
  const spinnerLabel = running ? STATUS_COPY.running : STATUS_COPY.queued;

  return (
    <StatusSection label={STATUS_COPY.subagents(live.length)} icon="agent" collapsedIndicator={<BrailleSpinner color={t.uiPurple} label={spinnerLabel} />}>
      <ScrollView style={{ maxHeight: height * 0.25 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {live.map((item) => (
          <SubagentRow key={item.id} item={item} now={now} selected={selected === item.id} onToggle={() => setSelected(selected === item.id ? null : item.id)} />
        ))}
      </ScrollView>
      {detail ? <SubagentControls key={detail.id} controller={controller} sessionKey={sessionKey} subagentId={detail.id} /> : null}
    </StatusSection>
  );
}

function SubagentRow({ item, now, selected, onToggle }: { item: Subagent; now: number; selected: boolean; onToggle: () => void }) {
  const t = useTokens();
  const seconds = Math.max(0, Math.floor((now - item.startedAt) / 1000));
  return (
    <StatusRow
      expanded={selected}
      onActivate={onToggle}
      leading={<BrailleSpinner color={t.uiPurple} label={item.status === 'queued' ? STATUS_COPY.queued : STATUS_COPY.running} size={13.6} />}
      trailing={
        <Text allowFontScaling={false} style={[styles.timer, { color: mixPct(t.uiAccent, 0.55, 'transparent') }]}>
          {formatElapsed(seconds)}
        </Text>
      }
    >
      <View style={styles.subagentText}>
        <Text numberOfLines={1} style={[styles.rowText, { color: t.uiTextPrimary, fontSize: 12 }]}>
          {item.goal}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: t.uiTextTertiary, fontSize: 10.9 }]}>
          {item.activity || (item.status === 'queued' ? STATUS_COPY.queued : STATUS_COPY.waitingActivity)}
        </Text>
      </View>
    </StatusRow>
  );
}

/** steer or stop one subagent: its own instructions line, never the parent turn's */
function SubagentControls({ controller, sessionKey, subagentId }: { controller: ChatController; sessionKey: string; subagentId: string }) {
  const t = useTokens();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');

  const send = async (action: 'steer' | 'interrupt') => {
    setPending(true);
    setFeedback('');
    const result = action === 'steer' ? await controller.status.steerSubagent(sessionKey, subagentId, text) : await controller.status.interruptSubagent(sessionKey, subagentId);
    setFeedback(result);
    if (action === 'steer' && result === STATUS_COPY.steerQueued) setText('');
    setPending(false);
  };

  return (
    <View style={styles.controls}>
      <View style={styles.controlsRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!pending}
          placeholder={STATUS_COPY.steerPlaceholder}
          placeholderTextColor={t.uiTextTertiary}
          accessibilityLabel={STATUS_COPY.steerPlaceholder}
          selectionColor={t.uiAccent}
          onSubmitEditing={() => text.trim() && !pending && void send('steer')}
          style={[styles.controlInput, { color: t.uiTextPrimary, borderColor: t.uiStrokeSecondary, borderRadius: t.radius.md }]}
        />
        <View style={{ opacity: pending || !text.trim() ? 0.4 : 1 }}>
          <MicroButton label={STATUS_COPY.steer} onPress={() => text.trim() && !pending && void send('steer')} />
        </View>
        <MicroButton label={STATUS_COPY.stop} onPress={() => !pending && void send('interrupt')} />
      </View>
      {feedback ? (
        <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: t.uiTextSecondary, fontSize: 11 }]}>
          {feedback}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // beside the composer: the dock's 16 side padding, then the desktop's mx-2 so the stack reads a little narrower;
  // pulled over the dock's top padding so its edge meets the composer's own
  wrap: { marginHorizontal: 16 + 8, marginBottom: -DOCK_TOP, paddingTop: 8 },
  wrapFolded: { paddingBottom: 8 },
  clip: { overflow: 'hidden' },
  card: { borderWidth: 1, borderBottomWidth: 0, overflow: 'hidden' },
  handle: { position: 'absolute', top: 0, left: '50%', marginLeft: -36, width: 72, height: 16, alignItems: 'center', justifyContent: 'center' },
  rowText: { flexShrink: 1, flexGrow: 1, fontSize: ROW_TEXT, lineHeight: 16 },
  meta: { flexShrink: 0, maxWidth: '45%', fontSize: 9.9, lineHeight: 16 },
  badge: { flexShrink: 0, paddingHorizontal: 4 },
  badgeText: { fontSize: 9.3, lineHeight: 16, fontWeight: '600' },
  timer: { fontSize: 9, lineHeight: 16, letterSpacing: 0.2 },
  subagentText: { flex: 1, minWidth: 0, flexDirection: 'column' },
  controls: { paddingLeft: 12 + 12 + 12.8 + 12, paddingRight: 10, paddingBottom: 8, gap: 4 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  controlInput: { flex: 1, minWidth: 0, height: 28, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 0, fontSize: 12 },
});
