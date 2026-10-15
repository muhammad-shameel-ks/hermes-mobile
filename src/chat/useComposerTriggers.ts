/**
 * The composer's trigger engine (desktop hooks/use-composer-trigger.ts), for a
 * plain TextInput: tracks the caret, detects a `/` or `@` token before it, and
 * hands the chat screen a descriptor for the sheet to show. Picking a row
 * replaces the token in the composer's text.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { NativeSyntheticEvent, TextInput, TextInputSelectionChangeEventData } from 'react-native';

import { detectTrigger, replaceToken, triggerStaysOpen, type Trigger } from './slash.ts';

/** what the sheets need to reach the gateway for the open chat */
export type SheetScope = {
  request: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
  /** the runtime id of the open chat, null on a draft */
  sessionId: string | null;
  profile: string;
};

export type ComposerSheet = {
  trigger: Trigger;
  /** replace the token with `text`; `close` keeps the sheet shut until the text changes again */
  insert: (text: string, options?: { close?: boolean }) => void;
  dismiss: () => void;
};

type Selection = { start: number; end: number };

export function useComposerTriggers({
  text,
  setText,
  inputRef,
  onSheet,
}: {
  text: string;
  setText: (text: string) => void;
  inputRef: RefObject<TextInput | null>;
  onSheet: (sheet: ComposerSheet | null) => void;
}) {
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [dismissedText, setDismissedText] = useState<string | null>(null);
  const latest = useRef({ text, selection });
  latest.current = { text, selection };

  const trigger = useMemo(() => {
    if (selection.start !== selection.end) return null;
    const found = detectTrigger(text.slice(0, Math.min(selection.start, text.length)));
    return found && triggerStaysOpen(found) ? found : null;
  }, [text, selection]);
  const open = trigger !== null && text !== dismissedText;

  const onChangeText = useCallback(
    (next: string) => {
      const { text: previous, selection: caret } = latest.current;
      // the caret event follows the text event; typing at the end keeps the caret there meanwhile
      if (caret.start === caret.end && caret.start >= previous.length) setSelection({ start: next.length, end: next.length });
      setText(next);
    },
    [setText],
  );

  const onSelectionChange = useCallback((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    setSelection(event.nativeEvent.selection);
  }, []);

  const dismiss = useCallback(() => setDismissedText(latest.current.text), []);

  const insert = useCallback(
    (replacement: string, options?: { close?: boolean }) => {
      if (!trigger) return;
      const { text: current, selection: caret } = latest.current;
      const next = replaceToken(current, Math.min(caret.start, current.length), trigger.tokenLength, replacement);
      setText(next.text);
      setSelection({ start: next.caret, end: next.caret });
      setDismissedText(options?.close ? next.text : null);
      inputRef.current?.focus();
      // a controlled value moves the caret to the end; put it back after a mid-text pick
      if (next.caret < next.text.length) setTimeout(() => inputRef.current?.setSelection?.(next.caret, next.caret), 0);
    },
    [trigger, setText, inputRef],
  );

  const sheet = useMemo<ComposerSheet | null>(() => (open && trigger ? { trigger, insert, dismiss } : null), [open, trigger, insert, dismiss]);
  useEffect(() => {
    onSheet(sheet);
  }, [sheet, onSheet]);
  useEffect(() => () => onSheet(null), [onSheet]);

  return { onChangeText, onSelectionChange };
}
