/**
 * Approval cards: the queue of commands the gateway waits on, drawn as the
 * desktop's approval stack (components/assistant-ui/tool/approval.tsx and
 * ui/card-stack.tsx) at the foot of the transcript. One card at a time, a 96%
 * silhouette peeking 7px behind it when more are queued, 220 ms to promote and
 * 180 ms to leave. Run answers `once`, Reject `deny`; the menu offers
 * session-wide and permanent allows (the permanent one behind a confirm).
 * Swiping the card left denies; no gesture ever grants.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, Keyframe, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Codicon } from '../ui/Codicon.tsx';
import { ActionSheet, Sheet } from '../ui/Sheet.tsx';
import { MONO, SCAFFOLD_OPACITY, useTokens, type Tokens } from '../ui/tokens.ts';
import { useRequests } from './RequestsContext.tsx';
import { RequestButton } from './requestUi.tsx';
import { APPROVAL_COPY, approvalDetails, approvalOptions, type ApprovalChoice, type ApprovalRequest } from './requests.ts';
import { summarizeToolRun } from './toolView.ts';

/** the chat rows' side inset (ChatScreen `SIDE_INSET`) */
const SIDE_INSET = 24;
/** desktop card-stack: one silhouette, 7px and 96% behind the front card */
const GAP = 7;
const SCALE = 0.96;
const EASE = Easing.bezier(0.23, 1, 0.32, 1);
const RETURN = { stiffness: 460, damping: 34, mass: 0.8 } as const;

const PROMOTE = new Keyframe({
  from: { opacity: 0.6, transform: [{ translateY: -GAP }, { scale: SCALE }] },
  to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: EASE },
}).duration(220);

const DEPART = new Keyframe({
  from: { opacity: 1, transform: [{ translateY: 0 }] },
  to: { opacity: 0, transform: [{ translateY: -14 }], easing: EASE },
}).duration(180);

const EDGE_IN = new Keyframe({ from: { opacity: 0 }, to: { opacity: 0.6, easing: EASE } }).duration(220);

const surface = (t: Tokens) => ({
  borderRadius: t.radius.xl,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: t.uiStrokeSecondary,
  backgroundColor: t.uiChatSurfaceBackground,
});

/** The transcript's approval host: the run summary and the card stack, mounted for the whole chat so a card can leave. */
export function PendingApprovals() {
  const { requests, activity } = useRequests();
  const { approvals, approvalTotal } = requests;
  const reduced = useReducedMotion();
  const padding = useSharedValue(0);
  const open = approvals.length > 0;

  useEffect(() => {
    // desktop: the block padding arrives at once and eases out over 220 ms
    padding.value = open ? 8 : withTiming(0, { duration: reduced ? 0 : 220, easing: Easing.inOut(Easing.ease) });
  }, [open, reduced, padding]);

  const animated = useAnimatedStyle(() => ({ paddingVertical: padding.value }));

  return (
    <View style={styles.footer}>
      <Animated.View style={[styles.stack, animated]}>
        {open ? <ApprovalActivity activity={activity} reduced={reduced} /> : null}
        <ApprovalQueue approvals={approvals} total={approvalTotal} reduced={reduced} />
      </Animated.View>
    </View>
  );
}

/** the turn's terminal and code calls summarised above the card, or the plain label when there are none */
function ApprovalActivity({ activity, reduced }: { activity: ReturnType<typeof useRequests>['activity']; reduced: boolean }) {
  const t = useTokens();
  const summary = activity.length ? summarizeToolRun(activity, activity.some((tool) => tool.status === 'running')) : '';
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(220)}
      exiting={reduced ? undefined : FadeOut.duration(220)}
      style={[styles.activity, { opacity: SCAFFOLD_OPACITY, minHeight: t.type.lineHeight }]}
    >
      <Text numberOfLines={1} style={{ color: t.conversationScaffoldText, fontSize: t.type.tool, lineHeight: t.type.lineHeight }}>
        {summary || APPROVAL_COPY.jumpToApproval}
      </Text>
    </Animated.View>
  );
}

function ApprovalQueue({ approvals, total, reduced }: { approvals: ApprovalRequest[]; total: number; reduced: boolean }) {
  const t = useTokens();
  const [height, setHeight] = useState(0);
  const front = approvals[0];
  const position = total - approvals.length + 1;

  return (
    <View style={{ paddingTop: front ? 8 : 0, minHeight: front ? height + 8 : 0 }}>
      {approvals.length > 1 ? (
        <Animated.View
          entering={reduced ? undefined : EDGE_IN}
          pointerEvents="none"
          style={[surface(t), styles.edge, { height, opacity: 0.6, transform: [{ translateY: -GAP }, { scale: SCALE }] }]}
        />
      ) : null}
      {front ? <StackCard key={front.requestId ?? 'legacy'} request={front} position={position} total={total} reduced={reduced} onMeasure={setHeight} /> : null}
    </View>
  );
}

function StackCard({ request, position, total, reduced, onMeasure }: { request: ApprovalRequest; position: number; total: number; reduced: boolean; onMeasure: (height: number) => void }) {
  const t = useTokens();
  const { actions } = useRequests();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null);
  const locked = useRef(false);
  const width = useRef(0);

  /** shared press feedback; the card leaves when the answer lands, and returns if it does not */
  const depart = useCallback(
    async (commit: () => Promise<boolean>) => {
      if (locked.current) return false;
      locked.current = true;
      setBusy(true);
      y.value = withTiming(reduced ? 0 : 1, { duration: 80 });
      const sent = await commit().catch(() => false);
      if (!sent) {
        locked.current = false;
        setBusy(false);
        x.value = reduced ? 0 : withSpring(0, RETURN);
        y.value = withTiming(0, { duration: reduced ? 0 : 120 });
      }
      return sent;
    },
    [reduced, x, y],
  );

  const respond = useCallback(
    (choice: ApprovalChoice) => {
      if (locked.current) return;
      setSubmitting(choice);
      void depart(() => actions.answerApproval(request.requestId, choice)).then((sent) => {
        if (!sent) setSubmitting(null);
      });
    },
    [actions, depart, request.requestId],
  );

  const swipeDeny = useCallback(() => void depart(() => actions.answerApproval(request.requestId, 'deny')), [actions, depart, request.requestId]);
  const latest = useRef({ swipeDeny, reduced });
  latest.current = { swipeDeny, reduced };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // a horizontal drag past 6px claims the gesture; vertical ones stay the list's
        onMoveShouldSetPanResponder: (_, g) => !locked.current && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          // only left is a swipe; right gives like a rubber band
          x.value = g.dx < 0 ? g.dx : g.dx / (1.5 + Math.abs(g.dx) / 20);
        },
        onPanResponderRelease: (_, g) => {
          const threshold = Math.min(96, width.current * 0.22);
          const fast = Math.abs(g.vx) > 0.5 && Math.abs(g.dx) > 18;
          if (g.dx < 0 && (Math.abs(g.dx) > threshold || fast)) latest.current.swipeDeny();
          else x.value = latest.current.reduced ? 0 : withSpring(0, RETURN);
        },
        onPanResponderTerminate: () => {
          x.value = latest.current.reduced ? 0 : withSpring(0, RETURN);
        },
      }),
    [x],
  );

  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  const measure = (event: LayoutChangeEvent) => {
    width.current = event.nativeEvent.layout.width;
    onMeasure(event.nativeEvent.layout.height);
  };

  return (
    <Animated.View
      entering={reduced ? undefined : PROMOTE}
      exiting={reduced ? undefined : DEPART}
      style={{ transformOrigin: 'top' }}
      pointerEvents={busy ? 'none' : 'auto'}
    >
      <Animated.View onLayout={measure} style={[surface(t), animated]} {...pan.panHandlers}>
        <ApprovalBody request={request} position={position} total={total} submitting={submitting} busy={busy} onChoose={respond} />
      </Animated.View>
    </Animated.View>
  );
}

function ApprovalBody({
  request,
  position,
  total,
  submitting,
  busy,
  onChoose,
}: {
  request: ApprovalRequest;
  position: number;
  total: number;
  submitting: ApprovalChoice | null;
  busy: boolean;
  onChoose: (choice: ApprovalChoice) => void;
}) {
  const t = useTokens();
  const [menu, setMenu] = useState(false);
  const [confirmAlways, setConfirmAlways] = useState(false);
  const { session, always } = approvalOptions(request);
  const { showsDescription, text } = approvalDetails(request);
  const disabled = busy || submitting !== null;

  const menuActions = [
    ...(session ? [{ label: APPROVAL_COPY.allowSession, onPress: () => onChoose('session') }] : []),
    // let the menu leave before the confirm opens, so the two sheets never fight over the screen
    ...(always ? [{ label: APPROVAL_COPY.alwaysAllowMenu, onPress: () => void setTimeout(() => setConfirmAlways(true), 50) }] : []),
    { label: APPROVAL_COPY.reject, destructive: true, onPress: () => onChoose('deny') },
  ];

  return (
    <View>
      <View style={styles.header}>
        <Codicon name="terminal" size={14} color={t.uiTextSecondary} />
        <Text style={[styles.headerText, { color: t.uiTextSecondary }]}>{showsDescription ? APPROVAL_COPY.commandDetails : APPROVAL_COPY.command}</Text>
        {total > 1 ? (
          <Text style={[styles.count, { color: t.uiTextTertiary }]}>
            {position} / {total}
          </Text>
        ) : null}
      </View>
      {text.length > 0 ? (
        <ScrollView style={styles.details} nestedScrollEnabled>
          <Text selectable style={[styles.detailsText, { color: t.uiTextPrimary }]}>
            {text}
          </Text>
        </ScrollView>
      ) : null}
      <View style={styles.actions}>
        <RequestButton label={APPROVAL_COPY.reject} variant="text" disabled={disabled} busy={submitting === 'deny'} onPress={() => onChoose('deny')} />
        {session || always ? (
          <RequestButton
            label={APPROVAL_COPY.alwaysAllowMenu}
            accessibilityLabel={APPROVAL_COPY.moreOptions}
            variant="secondary"
            disabled={disabled}
            onPress={() => setMenu(true)}
            trailing={<Codicon name="chevron-down" size={12} color={t.uiTextPrimary} />}
          />
        ) : null}
        <RequestButton label={APPROVAL_COPY.run} disabled={disabled} busy={submitting === 'once'} onPress={() => onChoose('once')} />
      </View>

      <ActionSheet visible={menu} actions={menuActions} onClose={() => setMenu(false)} />
      <Sheet visible={confirmAlways} onClose={() => setConfirmAlways(false)}>
        <View style={styles.confirm}>
          <Text style={[styles.confirmTitle, { color: t.uiTextPrimary }]}>{APPROVAL_COPY.alwaysTitle}</Text>
          <Text style={[styles.confirmBody, { color: t.uiTextSecondary }]}>{APPROVAL_COPY.alwaysDescription(request.description)}</Text>
          {request.command.trim() ? (
            <ScrollView
              style={[styles.confirmCommand, { borderColor: t.uiStrokeTertiary, backgroundColor: t.uiChatSurfaceBackground, borderRadius: t.radius.lg }]}
              nestedScrollEnabled
            >
              <Text selectable style={[styles.detailsText, { color: t.uiTextPrimary, lineHeight: 12 * 1.375 }]}>
                {request.command.trim()}
              </Text>
            </ScrollView>
          ) : null}
          <View style={styles.confirmActions}>
            <RequestButton label={APPROVAL_COPY.cancel} variant="ghost" onPress={() => setConfirmAlways(false)} />
            <RequestButton
              label={APPROVAL_COPY.alwaysAllow}
              variant="destructive"
              onPress={() => {
                setConfirmAlways(false);
                onChoose('always');
              }}
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: SIDE_INSET },
  stack: { width: '100%', maxWidth: 576 },
  activity: { marginBottom: 4, justifyContent: 'center' },
  edge: { position: 'absolute', left: 0, right: 0, top: 8, transformOrigin: 'top' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 8 },
  headerText: { fontSize: 12, lineHeight: 16 },
  count: { marginLeft: 'auto', fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  details: { maxHeight: 160, paddingHorizontal: 10, paddingVertical: 8 },
  detailsText: { fontFamily: MONO, fontSize: 12, lineHeight: 12 * 1.625 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 8, paddingBottom: 8, paddingTop: 4 },
  confirm: { paddingHorizontal: 20, paddingBottom: 4, gap: 10 },
  confirmTitle: { fontSize: 17, fontWeight: '600' },
  confirmBody: { fontSize: 13, lineHeight: 19 },
  confirmCommand: { maxHeight: 128, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
