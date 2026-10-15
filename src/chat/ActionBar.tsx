/**
 * The per-message action bar (desktop assistant-message.tsx `AssistantActionBar`,
 * user-message.tsx `UserBubbleActions`). On the desktop it fades in on hover; a
 * phone has no hover, so it is always painted at the desktop's resting 0.5
 * opacity (issue "Transcript and composer parity on touch"). A pressed control
 * goes to full strength as the hovered one does, and the stamp leads the row.
 *
 * Assistant: stamp, copy, copy full response, read aloud, retry, reaction slot.
 * User: stamp, reaction slot, edit, then Stop while that turn runs or Restore.
 * A reply still streaming keeps its bar's height without painting it, so the
 * transcript does not shift when the turn settles.
 */

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { press, tick } from '../ui/haptics.ts';
import { useTokens } from '../ui/tokens.ts';
import { COPIED_RESET_MS, formatElapsed, formatStamp, messageText, type BarPlan } from './actionBar.ts';
import { useMessageActions } from './messageChrome.tsx';
import { readAloud, stopReadAloud, useReadAloud } from './readAloud.ts';
import type { Message } from './transcript.ts';

/** desktop styles.css `[data-slot='aui_msg-actions'] button`: the controls' resting opacity */
const REST_OPACITY = 0.5;
const GLYPH = 20;
const HIT = { top: 8, bottom: 8, left: 5, right: 5 } as const;

function BarButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={HIT} style={({ pressed }) => ({ opacity: pressed ? 1 : REST_OPACITY })}>
      <View style={styles.glyph}>{children}</View>
    </Pressable>
  );
}

function GlyphButton({ label, name, color, onPress }: { label: string; name: CodiconName; color: string; onPress: () => void }) {
  return (
    <BarButton label={label} onPress={onPress}>
      <Codicon name={name} size={GLYPH} color={color} />
    </BarButton>
  );
}

function CopyButton({ label, name, color, text }: { label: string; name: CodiconName; color: string; text: () => string }) {
  const actions = useMessageActions();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    if (!(await actions.copy(text()))) return;
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [actions, text]);

  return <GlyphButton label={copied ? 'Copied' : label} name={copied ? 'check' : name} color={color} onPress={() => void copy()} />;
}

/** the reaction slot: the picker's trigger and the landed reactions are one element, so reacting never shifts the row */
function ReactionSlot({ message, color }: { message: Message; color: string }) {
  const actions = useMessageActions();
  const reactions = message.reactions ?? [];
  if (!actions.reactionsEnabled && !reactions.length) return null;
  if (!reactions.length) {
    return (
      <GlyphButton
        label="React"
        name="reactions"
        color={color}
        onPress={() => {
          tick();
          actions.react(message.id);
        }}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Reactions: ${reactions.map((reaction) => reaction.emoji).join(' ')}`}
      disabled={!actions.reactionsEnabled}
      onPress={() => {
        tick();
        actions.react(message.id);
      }}
      hitSlop={HIT}
      style={styles.reactions}
    >
      {reactions.map((reaction) => (
        <Text key={`${reaction.author}-${reaction.emoji}`} allowFontScaling={false} style={styles.emoji}>
          {reaction.emoji}
        </Text>
      ))}
    </Pressable>
  );
}

function ActionBarImpl({ message, plan }: { message: Message; plan: BarPlan }) {
  const t = useTokens();
  const actions = useMessageActions();
  const stamp = formatStamp(message.timestamp);
  const live = plan.kind === 'assistant' && plan.live;
  const text = useCallback(() => messageText(message), [message]);
  const full = useCallback(() => actions.fullResponseText(message.id), [actions, message.id]);
  const speech = useReadAloud();
  const reading = speech.status !== 'idle' && speech.id === message.id;

  const time = stamp ? <Text style={[styles.time, { color: t.uiTextTertiary }]}>{stamp}</Text> : null;

  return (
    <View
      style={[styles.bar, live && styles.hidden]}
      pointerEvents={live ? 'none' : 'auto'}
      accessibilityElementsHidden={live}
      importantForAccessibility={live ? 'no-hide-descendants' : 'auto'}
    >
      {plan.kind === 'assistant' ? (
        <>
          {message.durationS !== undefined ? (
            <Text style={[styles.duration, { color: t.uiTextTertiary }]} accessibilityLabel={`This turn took ${formatElapsed(message.durationS)}`}>
              {`⏱ ${formatElapsed(message.durationS)}`}
            </Text>
          ) : null}
          {time}
          <CopyButton label="Copy" name="copy" color={t.uiTextTertiary} text={text} />
          {plan.fullAvailable ? <CopyButton label="Copy full response" name="clone" color={t.uiTextTertiary} text={full} /> : null}
          {speech.available ? (
            <GlyphButton
              label={reading ? 'Stop reading' : 'Read aloud'}
              name={reading ? 'mute' : 'unmute'}
              color={t.uiTextTertiary}
              onPress={() => {
                tick();
                if (reading) stopReadAloud();
                else readAloud(text(), message.id).catch(() => actions.notify('Read aloud failed'));
              }}
            />
          ) : null}
          <GlyphButton
            label="Refresh"
            name="refresh"
            color={t.uiTextTertiary}
            onPress={() => {
              press();
              actions.retry(message.id);
            }}
          />
          <ReactionSlot message={message} color={t.uiTextTertiary} />
        </>
      ) : (
        <>
          {time}
          <ReactionSlot message={message} color={t.uiTextSecondary} />
          <GlyphButton
            label="Edit message"
            name="edit"
            color={t.uiTextSecondary}
            onPress={() => {
              tick();
              actions.edit(message.id);
            }}
          />
          {plan.stop ? (
            <BarButton label="Stop" onPress={actions.stop}>
              <View style={[styles.stop, { backgroundColor: t.uiTextSecondary }]} />
            </BarButton>
          ) : (
            <GlyphButton
              label="Restore checkpoint"
              name="discard"
              color={t.uiTextSecondary}
              onPress={() => {
                tick();
                actions.restore(message.id);
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

export const ActionBar = memo(ActionBarImpl);

const styles = StyleSheet.create({
  // desktop: `flex min-h-6 items-center justify-end gap-1.5 py-1.5`; the phone's glyphs and gap are larger for touch
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, minHeight: 24, paddingVertical: 6 },
  hidden: { opacity: 0 },
  glyph: { width: GLYPH, height: GLYPH, alignItems: 'center', justifyContent: 'center' },
  // desktop: text-[0.6875rem] leading-5 tabular-nums, mr-1 on the stamp, mr-auto on the duration
  time: { fontSize: 11, lineHeight: 20, marginRight: 4, fontVariant: ['tabular-nums'] },
  duration: { marginRight: 'auto', paddingHorizontal: 2, fontSize: 11, lineHeight: 20, fontVariant: ['tabular-nums'] },
  stop: { width: 14, height: 14, borderRadius: 3 },
  // a landed reaction is content, not a dimmed control: gap-0.5, 0.8125rem, full strength
  reactions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  emoji: { fontSize: 13, lineHeight: 16 },
});
