/**
 * The attention banner: a request waiting in a chat other than the open one,
 * dropped over whatever is on screen (the drawer and pushed routes included).
 * An approval is answered right here with Run or Reject; anything that needs
 * typing or picking opens its chat. The X waves one request off; the next
 * request, or the next chat's, comes down in its place.
 *
 * Mounted inside the overlay stack (its `above` slot), since Open pops the
 * pushed routes. Also where taps on the system's attention notifications land.
 */

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlay } from '../app/overlay.tsx';
import type { ChatController } from '../chat/controller.ts';
import { RequestButton } from '../chat/requestUi.tsx';
import { APPROVAL_COPY, type ApprovalChoice } from '../chat/requests.ts';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { outcome, tick } from '../ui/haptics.ts';
import { MONO, useTokens } from '../ui/tokens.ts';
import { ATTENTION_COPY, type Attention, type AttentionKind, type AttentionTarget } from './attention.ts';
import type { AttentionCenter } from './center.ts';
import { onAttentionOpened } from './notifier.ts';

/** the drawer dot's "act now" amber (StatusDot) */
const AMBER = '#f59e0b';

const ICONS: Record<AttentionKind, CodiconName> = {
  approval: 'terminal',
  clarify: 'comment',
  sudo: 'lock',
  secret: 'lock',
  'vault-unlock': 'lock',
  'vault-save': 'lock',
  'vault-code': 'lock',
};

/** commands read as code; questions and prompt titles as prose */
const MONO_KINDS: Partial<Record<AttentionKind, true>> = { approval: true, sudo: true };

export function AttentionHost({ center, controller, onNavigate }: { center: AttentionCenter; controller: ChatController; onNavigate: () => void }) {
  const overlay = useOverlay();
  const items = useSyncExternalStore(center.subscribe, center.getItems);
  const latest = useRef({ overlay, onNavigate });
  latest.current = { overlay, onNavigate };

  const open = useCallback(
    (target: AttentionTarget) => {
      latest.current.onNavigate();
      latest.current.overlay.clear();
      controller.openChat(target);
    },
    [controller],
  );

  useEffect(() => onAttentionOpened(open), [open]);
  const dismiss = useCallback((id: string) => center.dismiss(id), [center]);

  const head = items[0];
  const arrived = useRef<string | null>(null);
  useEffect(() => {
    if (!head || head.id === arrived.current) return;
    arrived.current = head.id;
    tick();
  }, [head]);

  if (!head) return null;
  return <Banner key={head.id} item={head} more={items.length - 1} controller={controller} onOpen={open} onDismiss={dismiss} />;
}

const Banner = memo(function Banner({
  item,
  more,
  controller,
  onOpen,
  onDismiss,
}: {
  item: Attention;
  more: number;
  controller: ChatController;
  onOpen: (target: AttentionTarget) => void;
  onDismiss: (id: string) => void;
}) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null);

  const answer = (choice: ApprovalChoice) => {
    if (submitting || !item.approval) return;
    setSubmitting(choice);
    void controller.serverRequests.answerApproval(item.key, item.approval.requestId, choice).then((sent) => {
      // a sent answer takes the banner down with the request; a failed one says why in the notice
      if (sent) outcome(choice === 'deny' ? 'cancel' : 'submit');
      else setSubmitting(null);
    });
  };

  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      exiting={FadeOutUp.duration(160)}
      style={[
        styles.banner,
        { top: insets.top + 6, backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Pressable
        onPress={() => onOpen(item.target)}
        accessibilityRole="button"
        accessibilityLabel={`${item.headline} in ${item.chat}. ${ATTENTION_COPY.open}`}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.75 }]}
      >
        <View style={styles.header}>
          <Codicon name={ICONS[item.kind]} size={14} color={AMBER} />
          <Text numberOfLines={1} style={[styles.headline, { color: t.uiTextSecondary }]}>
            {item.headline}
            <Text style={{ color: t.uiTextTertiary }}> · </Text>
            <Text style={[styles.chat, { color: t.uiTextPrimary }]}>{item.chat}</Text>
          </Text>
          {more > 0 ? <Text style={[styles.more, { color: t.uiTextTertiary }]}>{ATTENTION_COPY.more(more)}</Text> : null}
        </View>
        {item.detail ? (
          <Text numberOfLines={2} style={[MONO_KINDS[item.kind] ? styles.code : styles.prose, { color: t.uiTextPrimary }]}>
            {item.detail}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        onPress={() => onDismiss(item.id)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={ATTENTION_COPY.dismiss}
        style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
      >
        <Codicon name="close" size={14} color={t.uiTextTertiary} />
      </Pressable>
      <View style={styles.actions}>
        {item.approval ? (
          <>
            <RequestButton label={APPROVAL_COPY.reject} variant="text" disabled={submitting !== null} busy={submitting === 'deny'} onPress={() => answer('deny')} />
            <RequestButton label={ATTENTION_COPY.open} variant="secondary" disabled={submitting !== null} onPress={() => onOpen(item.target)} />
            <RequestButton label={APPROVAL_COPY.run} disabled={submitting !== null} busy={submitting === 'once'} onPress={() => answer('once')} />
          </>
        ) : (
          <RequestButton label={ATTENTION_COPY.open} onPress={() => onOpen(item.target)} />
        )}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  body: { paddingLeft: 12, paddingRight: 40, paddingTop: 10, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headline: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
  chat: { fontWeight: '600' },
  more: { marginLeft: 'auto', fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  code: { fontFamily: MONO, fontSize: 12, lineHeight: 12 * 1.625 },
  prose: { fontSize: 13, lineHeight: 18 },
  close: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
});
