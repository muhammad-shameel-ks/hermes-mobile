/**
 * What the settings sections need from the signed-in app. Pushed overlays render
 * above the chat from a closure captured at push time, so sections read live
 * state through this context rather than through props.
 *
 * The provided value is stable for the app's lifetime: it carries no chat state. `useSettings`
 * subscribes the calling section to the snapshot slice it reads, so the sections re-render with
 * the snapshot while one is open, and nothing re-renders for settings while none is.
 */

import { createContext, useContext, useMemo } from 'react';

import type { SavedConnection } from '../auth/store.ts';
import { settingsSlice, type SettingsSlice } from '../chat/chatSlices.ts';
import type { ChatController } from '../chat/controller.ts';
import { shallowEqual } from '../chat/selector.ts';
import { useChatSelector } from '../chat/useChatSelector.ts';

export type SettingsProviderValue = {
  controller: ChatController;
  connection: SavedConnection;
  onSignOut: () => void;
};

export type SettingsHost = SettingsProviderValue & {
  snapshot: SettingsSlice;
};

const SettingsContext = createContext<SettingsProviderValue | null>(null);

export const SettingsProvider = SettingsContext.Provider;

export function useSettings(): SettingsHost {
  const host = useContext(SettingsContext);
  if (!host) throw new Error('useSettings must be used inside <SettingsProvider>');
  const snapshot = useChatSelector(host.controller, settingsSlice, shallowEqual);
  return useMemo(() => ({ ...host, snapshot }), [host, snapshot]);
}
