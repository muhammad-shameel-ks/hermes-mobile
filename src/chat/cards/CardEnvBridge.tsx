/**
 * Hands the inline cards their doors into the pushed routes: the Review surface
 * and a delegated child's session. Mounted inside the overlay stack, since the
 * routes need it.
 */

import { useEffect } from 'react';

import { useOverlay } from '../../app/overlay.tsx';
import { openReview } from '../../review/open.tsx';
import type { ChatController } from '../controller.ts';
import { setCardEnv } from './env.ts';

export function CardEnvBridge({ controller }: { controller: ChatController }) {
  const overlay = useOverlay();
  useEffect(() => {
    setCardEnv({
      openReview: (path) => {
        const cwd = controller.openCwd();
        openReview(overlay, { ...(cwd ? { cwd } : {}), ...(path ? { path } : {}) });
      },
      openSession: (sessionId) => {
        overlay.clear();
        controller.openSession({ id: sessionId, title: null });
      },
    });
    return () => setCardEnv({ openReview: undefined, openSession: undefined });
  }, [overlay.push, overlay.clear, controller]);
  return null;
}
