/**
 * What the reader has folded in the drawer, kept for the app's lifetime so closing the drawer does
 * not unfold it again. The desktop persists these (`$sidebarPinsOpen`, `$sidebarRecentsOpen`,
 * `$sidebarMessagingOpenIds`, the divider groups); the phone keeps them in memory (parity deviation).
 */

import { useSyncExternalStore } from 'react';

export type DrawerFolds = {
  pinsOpen: boolean;
  recentsOpen: boolean;
  /** platform sections the reader opened: they collapse by default */
  messagingOpen: readonly string[];
  /** date dividers the reader closed */
  closedGroups: readonly string[];
  /** how many rows each platform shows past the initial few */
  messagingVisible: Readonly<Record<string, number>>;
  hiddenBotsOpen: boolean;
  /** roster sections closed by the reader; keyed like the dividers */
  closedBotGroups: readonly string[];
};

const INITIAL: DrawerFolds = { pinsOpen: true, recentsOpen: true, messagingOpen: [], closedGroups: [], messagingVisible: {}, hiddenBotsOpen: false, closedBotGroups: [] };

let state = INITIAL;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function updateFolds(patch: Partial<DrawerFolds>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const toggleIn = (list: readonly string[], key: string) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);

export const useDrawerFolds = () => useSyncExternalStore(subscribe, () => state);
export const getDrawerFolds = () => state;
