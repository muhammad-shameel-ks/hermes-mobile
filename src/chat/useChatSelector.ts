/**
 * Subscribe a component to one slice of the chat controller's snapshot. The component re-renders
 * only when the selected slice changes under `isEqual` (default `Object.is`), not on every store
 * notification. Never read the whole snapshot in a component that stays mounted while a turn
 * streams: every token replaces the open entry, so a whole-snapshot subscriber re-renders per token.
 *
 * The selector may be an inline closure, but it runs on every notification, so keep it O(1) (or
 * O(entries)); return a flat object of references and pass `shallowEqual`.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { ChatController, ChatSnapshot } from './controller.ts';
import { createMemoSelect, type Equality } from './selector.ts';

export function useChatSelector<T>(controller: ChatController, selector: (snapshot: ChatSnapshot) => T, isEqual: Equality<T> = Object.is): T {
  const memo = useRef<ReturnType<typeof createMemoSelect<ChatSnapshot, T>> | null>(null);
  memo.current ??= createMemoSelect<ChatSnapshot, T>();
  const read = memo.current;
  const getSnapshot = useCallback(() => read(controller.getSnapshot(), selector, isEqual), [controller, read, selector, isEqual]);
  return useSyncExternalStore(controller.subscribe, getSnapshot, getSnapshot);
}
