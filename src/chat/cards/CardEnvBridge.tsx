/**
 * Hands the inline cards their doors into the pushed routes: the Review
 * surface, the file preview viewer and a delegated child's session. Mounted
 * inside the overlay stack, since the routes need it.
 */

import { useEffect } from 'react';

import { useOverlay } from '../../app/overlay.tsx';
import { openPreview } from '../../files/open.tsx';
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
      openPreview: (target) => openPreview(overlay, target),
      openCwd: () => controller.openCwd(),
      openSession: (sessionId) => {
        overlay.clear();
        controller.openSession({ id: sessionId, title: null });
      },
    });
    return () => setCardEnv({ openReview: undefined, openPreview: undefined, openCwd: undefined, openSession: undefined });
  }, [overlay.push, overlay.clear, controller]);
  return null;
}
