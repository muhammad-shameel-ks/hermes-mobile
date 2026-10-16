/**
 * `GroupRoom.members` and `RoomDriverStatus` are rebuilt fresh by the data layer on every poll, even when
 * nothing changed (rooms.ts and roomStore.ts hold no cache of their own). Handing memoised rows and cards
 * a reference that keeps its identity while the content is the same stops the whole timeline and the
 * pending-action stack from re-rendering every 1.5-4s poll tick.
 */
import { useRef } from 'react';

import type { RoomDriverStatus } from '../../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { pendingActions, type GroupMember, type PendingAction } from '../rooms.ts';

const EMPTY_MEMBERS: readonly GroupMember[] = [];
const EMPTY_ACTIONS: readonly PendingAction[] = [];

function stabilize<T>(ref: { current: { signature: string; value: T } }, signature: string, value: T): T {
  if (signature !== ref.current.signature) ref.current = { signature, value };
  return ref.current.value;
}

export function useStableMembers(members: readonly GroupMember[] | undefined): readonly GroupMember[] {
  const ref = useRef<{ signature: string; value: readonly GroupMember[] }>({ signature: '', value: EMPTY_MEMBERS });
  const next = members ?? EMPTY_MEMBERS;
  const signature = next.map((m) => `${m.memberId}:${m.profile}:${m.handle}:${m.label}`).join('\n');
  return stabilize(ref, signature, next);
}

export function useStablePendingActions(driver: RoomDriverStatus | null): readonly PendingAction[] {
  const ref = useRef<{ signature: string; value: readonly PendingAction[] }>({ signature: '', value: EMPTY_ACTIONS });
  const next = pendingActions(driver);
  const signature = next.map((a) => a.key).join('\n');
  return stabilize(ref, signature, next);
}
