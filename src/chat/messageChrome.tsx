/**
 * Everything the per-message chrome needs from the open chat, behind one hook: the
 * bar each message carries, the stable action callbacks the bars call, the edit
 * state the composer reads, and the sheets (reaction picker, rewind confirm).
 * ChatScreen calls `useMessageChrome` once; rows stay memoised because the action
 * object is stable and each bar plan keeps its identity until it changes.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Codicon } from '../ui/Codicon.tsx';
import { copyText } from '../ui/clipboard.ts';
import { ActionSheet } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { fullResponseText, planBars, stablePlans, userReaction, type BarPlan } from './actionBar.ts';
import type { ChatController, ChatEntry } from './controller.ts';
import { ReactionSheet } from './ReactionSheet.tsx';
import { planRewind, promptText, RESTORE_COPY } from './rewind.ts';

export type MessageActions = {
  reactionsEnabled: boolean;
  /** true once the text is on the clipboard */
  copy: (text: string) => Promise<boolean>;
  fullResponseText: (messageId: string) => string;
  retry: (messageId: string) => void;
  restore: (messageId: string) => void;
  edit: (messageId: string) => void;
  react: (messageId: string) => void;
  stop: () => void;
  notify: (text: string) => void;
};

const noop = () => undefined;

const MessageActionsContext = createContext<MessageActions>({
  reactionsEnabled: false,
  copy: async () => false,
  fullResponseText: () => '',
  retry: noop,
  restore: noop,
  edit: noop,
  react: noop,
  stop: noop,
  notify: noop,
});

export const MessageActionsProvider = MessageActionsContext.Provider;
export const useMessageActions = () => useContext(MessageActionsContext);

/** the user turn being rewritten in the composer */
export type EditTarget = { messageId: string; text: string; nonce: number };

export type MessageEdit = {
  target: EditTarget | null;
  cancel: () => void;
  /** resolves true once the edit is sent (or needed no sending) and the composer can let go of it */
  submit: (text: string) => Promise<boolean>;
};

export type MessageChrome = {
  actions: MessageActions;
  bars: Map<string, BarPlan>;
  edit: MessageEdit;
  /** the sheets the chrome opens; render once, anywhere in the chat */
  sheets: ReactNode;
};

export function useMessageChrome(controller: ChatController, entry: ChatEntry, reactionsEnabled: boolean): MessageChrome {
  const { transcript } = entry;
  const latest = useRef(transcript);
  latest.current = transcript;

  const previous = useRef(new Map<string, BarPlan>());
  const bars = useMemo(() => {
    const next = stablePlans(previous.current, planBars(transcript.messages, transcript.running));
    previous.current = next;
    return next;
  }, [transcript.messages, transcript.running]);

  const [picking, setPicking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    setPicking(null);
    setTarget(null);
  }, [entry.key]);

  const settle = (ok: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setConfirming(false);
    resolve?.(ok);
  };

  const parts = useMemo(() => {
    const confirm = () =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        setConfirming(true);
      });

    /** desktop planConfirmedReload / planConfirmedEdit: a cut that archives later user turns asks first; restore always does */
    const rewind = async (messageId: string, options: { text?: string; always?: boolean } = {}): Promise<boolean> => {
      const plan = planRewind(latest.current.messages, messageId, options.text);
      if (!plan) {
        controller.notify('Could not find the message to restore.');
        return false;
      }
      let confirmDeep = false;
      if (options.always || plan.laterUserTurns > 0) {
        if (!(await confirm())) return false;
        confirmDeep = true;
      }
      let outcome = await controller.rewind(messageId, { text: options.text, confirmDeep });
      if (outcome === 'confirm') {
        if (!(await confirm())) return false;
        outcome = await controller.rewind(messageId, { text: options.text, confirmDeep: true });
      }
      return outcome === 'ok';
    };
    return { confirm, rewind };
  }, [controller]);

  const actions = useMemo<MessageActions>(
    () => ({
      reactionsEnabled,
      copy: async (text) => {
        if (!text) return false;
        try {
          await copyText(text);
          return true;
        } catch {
          controller.notify('Copy failed');
          return false;
        }
      },
      fullResponseText: (messageId) => fullResponseText(latest.current.messages, messageId),
      notify: (text) => controller.notify(text),
      retry: (messageId) => void parts.rewind(messageId),
      restore: (messageId) => void parts.rewind(messageId, { always: true }),
      edit: (messageId) => {
        const message = latest.current.messages.find((m) => m.id === messageId && m.role === 'user');
        if (message) setTarget({ messageId, text: promptText(message), nonce: (nonce.current += 1) });
      },
      react: (messageId) => setPicking(messageId),
      stop: () => void controller.stop(),
    }),
    [controller, parts, reactionsEnabled],
  );

  const edit = useMemo<MessageEdit>(
    () => ({
      target,
      cancel: () => setTarget(null),
      submit: async (text) => {
        if (!target) return false;
        const next = text.trim();
        const original = latest.current.messages.find((m) => m.id === target.messageId);
        if (!next) return false;
        if (original && promptText(original) === next) {
          setTarget(null);
          return true;
        }
        const sent = await parts.rewind(target.messageId, { text: next });
        if (sent) setTarget(null);
        return sent;
      },
    }),
    [parts, target],
  );

  const picked = picking ? latest.current.messages.find((m) => m.id === picking) : undefined;
  const sheets = (
    <>
      <ReactionSheet
        visible={picking !== null}
        selected={userReaction(picked?.reactions)}
        onSelect={(emoji) => {
          if (picking) void controller.react(picking, emoji);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <ActionSheet
        visible={confirming}
        title={RESTORE_COPY.title}
        subtitle={RESTORE_COPY.body}
        actions={[
          { label: RESTORE_COPY.confirm, destructive: true, onPress: () => settle(true) },
          { label: 'Cancel', onPress: () => settle(false) },
        ]}
        onClose={() => queueMicrotask(() => settle(false))}
      />
    </>
  );

  return { actions, bars, edit, sheets };
}

/**
 * Editing reuses the composer: while an edit is open the composer holds the message text,
 * and the draft it replaced comes back when the edit ends.
 */
export function useEditingText(edit: MessageEdit, text: string, setText: (text: string) => void, onBegin?: () => void) {
  const stash = useRef<string | null>(null);
  const current = useRef(text);
  current.current = text;
  const nonce = edit.target?.nonce ?? null;
  const opened = edit.target?.text;

  useEffect(() => {
    if (nonce !== null) {
      if (stash.current === null) stash.current = current.current;
      setText(opened ?? '');
      onBegin?.();
    } else if (stash.current !== null) {
      setText(stash.current);
      stash.current = null;
    }
    // only a new edit (or its end) moves the text; typing must not re-run this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
}

/** the line above the composer while an edit is open */
export function EditBanner({ edit }: { edit: MessageEdit }) {
  const t = useTokens();
  if (!edit.target) return null;
  return (
    <View style={styles.banner}>
      <Codicon name="edit" size={12} color={t.uiTextTertiary} />
      <Text style={[styles.bannerText, { color: t.uiTextTertiary }]} numberOfLines={1}>
        Editing message
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel edit" onPress={edit.cancel} hitSlop={10} style={styles.bannerCancel}>
        <Codicon name="close" size={12} color={t.uiTextTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 4 },
  bannerText: { flex: 1, fontSize: 12 },
  bannerCancel: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
});
