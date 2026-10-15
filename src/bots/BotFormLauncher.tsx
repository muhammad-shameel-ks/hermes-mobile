/**
 * Opens New bot and Edit as pushed screens. It lives inside the overlay
 * provider (the app shell sits outside it), so the shell reaches it through a ref.
 */

import { useEffect, useMemo, type MutableRefObject } from 'react';

import { useOverlay } from '../app/overlay.tsx';
import type { ChatController } from '../chat/controller.ts';
import { createAvatarApi } from './avatarApi.ts';
import BotForm from './BotForm.tsx';
import type { Bot } from './roster.ts';

export type BotFormLaunch = (bot: Bot | null) => void;

export function BotFormLauncher({ controller, launchRef, onCreated }: { controller: ChatController; launchRef: MutableRefObject<BotFormLaunch | null>; onCreated: () => void }) {
  const overlay = useOverlay();
  const api = useMemo(() => createAvatarApi(controller.request, () => controller.getSnapshot().profile), [controller]);

  useEffect(() => {
    launchRef.current = (bot) => {
      const { visible, hidden } = controller.getSnapshot().roster;
      const takenNames = new Set([...visible, ...hidden].map((b) => b.name));
      overlay.push(`bot-form:${bot?.name ?? 'new'}`, (close) => (
        <BotForm bot={bot} controller={controller} api={api} takenNames={takenNames} onClose={close} onCreated={onCreated} />
      ));
    };
    return () => {
      launchRef.current = null;
    };
  }, [overlay, controller, api, launchRef, onCreated]);

  return null;
}
