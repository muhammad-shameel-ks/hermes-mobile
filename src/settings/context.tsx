/**
 * What the settings sections need from the signed-in app. Pushed overlays render
 * above the chat from a closure captured at push time, so sections read live
 * state through this context rather than through props.
 */

import { createContext, useContext } from 'react';

import type { SavedConnection } from '../auth/store.ts';
import type { ChatController, ChatSnapshot } from '../chat/controller.ts';

export type SettingsHost = {
  controller: ChatController;
  snapshot: ChatSnapshot;
  connection: SavedConnection;
  onSignOut: () => void;
};

const SettingsContext = createContext<SettingsHost | null>(null);

export const SettingsProvider = SettingsContext.Provider;

export function useSettings(): SettingsHost {
  const host = useContext(SettingsContext);
  if (!host) throw new Error('useSettings must be used inside <SettingsProvider>');
  return host;
}
