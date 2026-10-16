/**
 * Opens New group chat and a room as pushed screens, mirroring `BotFormLauncher.tsx`. It lives inside
 * the overlay provider (the app shell sits outside it), so the shell reaches it through a ref.
 */

import { useEffect, type MutableRefObject } from 'react';

import { useOverlay } from '../app/overlay.tsx';
import type { ChatController } from '../chat/controller.ts';
import { lazyScreen } from '../ui/lazy.tsx';
import type { GroupsModel } from './model.ts';
import type { GroupRoom } from './rooms.ts';

const NewGroupScreen = lazyScreen(() => require('./NewGroupScreen.tsx') as typeof import('./NewGroupScreen.tsx'));
const GroupRoomScreen = lazyScreen(() => require('./GroupRoomScreen.tsx') as typeof import('./GroupRoomScreen.tsx'));

export type GroupLaunch = {
  newGroup: () => void;
  openRoom: (room: Pick<GroupRoom, 'id' | 'name'>) => void;
};

export function GroupLauncher({
  controller,
  model,
  launchRef,
  onNavigate,
}: {
  controller: ChatController;
  model: GroupsModel;
  launchRef: MutableRefObject<GroupLaunch | null>;
  onNavigate: () => void;
}) {
  const overlay = useOverlay();

  useEffect(() => {
    // called from the drawer (a row tap) or from onCreated below; either way the drawer must close first
    const openRoom: GroupLaunch['openRoom'] = (room) => {
      onNavigate();
      overlay.push(`group:${room.id}`, (close) => <GroupRoomScreen controller={controller} model={model} roomId={room.id} name={room.name} onClose={close} />);
    };
    const newGroup = () => {
      overlay.push('group-new', (close) => (
        <NewGroupScreen
          controller={controller}
          model={model}
          onClose={close}
          onCreated={(room) => {
            close();
            openRoom(room);
          }}
        />
      ));
    };
    launchRef.current = { newGroup, openRoom };
    return () => {
      launchRef.current = null;
    };
  }, [overlay, controller, model, launchRef, onNavigate]);

  return null;
}
