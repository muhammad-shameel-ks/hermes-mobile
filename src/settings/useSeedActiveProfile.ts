import { useEffect } from 'react';

import type { ChatController } from '../chat/controller.ts';
import { readActiveProfile } from './active-profile.ts';

/** First connect seeds the active profile from the gateway, unless the reader has already moved on. */
export function useSeedActiveProfile(controller: ChatController) {
  useEffect(() => {
    let live = true;
    void readActiveProfile(controller.api).then((name) => {
      if (!live || !name) return;
      const { profile, openKey } = controller.getSnapshot();
      if (name !== profile && profile === 'default' && openKey === 'draft') controller.useProfile(name);
    });
    return () => {
      live = false;
    };
  }, [controller]);
}
