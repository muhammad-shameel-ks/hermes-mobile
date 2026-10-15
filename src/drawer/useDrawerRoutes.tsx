/**
 * The drawer's pushed routes: the Settings chip and the Capabilities row each
 * close the drawer and push their screen onto the overlay stack (back pops it).
 */

import { useMemo } from 'react';

import { useOverlay } from '../app/overlay.tsx';
import { pushCapabilities, pushSettings } from '../settings/open.tsx';

export function useDrawerRoutes(onNavigate: () => void) {
  const overlay = useOverlay();
  const { push } = overlay;
  return useMemo(
    () => ({
      openSettings: () => {
        onNavigate();
        pushSettings({ push });
      },
      openCapabilities: () => {
        onNavigate();
        pushCapabilities({ push });
      },
    }),
    [push, onNavigate],
  );
}
