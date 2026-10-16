/**
 * The React edge of the group stores: `useGroups` reads the roster of rooms, `useRoom` opens one room's live
 * store for as long as its screen is mounted (polling runs only then).
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { GroupsModel, GroupsState } from './model.ts';
import type { RoomSnapshot, RoomStore } from './roomStore.ts';

export function useGroups(model: GroupsModel): GroupsState {
  return useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
}

/** the live store for `roomId`, started on mount and stopped on unmount, with its snapshot */
export function useRoom(model: GroupsModel, roomId: string): { store: RoomStore; room: RoomSnapshot } {
  const store = useMemo(() => model.open(roomId), [model, roomId]);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const room = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, room };
}
