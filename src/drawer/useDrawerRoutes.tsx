/**
 * The drawer's pushed routes: the Settings chip and the Capabilities row each
 * close the drawer and push their screen onto the overlay stack (back pops it).
 */

import { useMemo } from 'react';

import { useOverlay } from '../app/overlay.tsx';
import CapabilitiesScreen from '../settings/CapabilitiesScreen.tsx';
import SettingsScreen, { SETTINGS_OVERLAY_KEY } from '../settings/SettingsScreen.tsx';

export function useDrawerRoutes(onNavigate: () => void) {
  const { push } = useOverlay();
  return useMemo(
    () => ({
      openSettings: () => {
        onNavigate();
        push(SETTINGS_OVERLAY_KEY, (close) => <SettingsScreen onBack={close} />);
      },
      openCapabilities: () => {
        onNavigate();
        push('capabilities', (close) => <CapabilitiesScreen onBack={close} />);
      },
    }),
    [push, onNavigate],
  );
}
