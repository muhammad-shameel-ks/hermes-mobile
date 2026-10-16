/**
 * The `groups.*` methods the phone speaks (the gateway's `tui_gateway/methods_groups.py`), each carrying the
 * active profile as the desktop's canonical-group requests do. The methods only a session authority serves
 * (`groups.attachment.*`, `groups.discard`) are not here: the phone's gateway is text-only for rooms.
 */

import { JsonRpcGatewayError } from '../../vendor/hermes-shared/src/json-rpc-channel.ts';
import type {
  GroupsApproveResult,
  GroupsDisbandResult,
  GroupsRenameResult,
  GroupsRetryResult,
  GroupsSendResult,
  GroupsStopResult,
  Room,
  RoomDriverStatus,
  RoomEvent,
  RpcMethods,
} from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { memberInput, newGroupProblem, MAX_GROUP_NAME } from './rooms.ts';
import type { Bot } from '../bots/roster.ts';

export type GroupsRpc = <M extends keyof RpcMethods>(method: M, params: RpcMethods[M]['params'], timeoutMs?: number) => Promise<RpcMethods[M]['result']>;

/** events per `groups.log` page; the gateway's own ceiling is 500 */
const PAGE = 200;
/** the newest events a room opens with, and how far each "earlier" pull reaches back */
export const TAIL_EVENTS = 200;
/** `HostedRoomError` codes that mean the room itself is gone, not that a call failed */
const ROOM_NOT_FOUND_CODE = 4114;

export type RoomRead = { events: RoomEvent[]; latestSeq: number };
export type RoomState = { room: Room; driver: RoomDriverStatus | null };

/** the gateway answered "no such room": disbanded elsewhere, or never existed here */
export function isRoomGone(error: unknown): boolean {
  return error instanceof JsonRpcGatewayError && (error.code === ROOM_NOT_FOUND_CODE || /not found/i.test(error.message));
}

/** an RPC that came back with the gateway's own refusal, as opposed to a timeout or a dropped socket */
export const isDefinitive = (error: unknown): boolean => error instanceof JsonRpcGatewayError;

/** the identity a pending approval is answered by: the exact task, generation and request */
export type ApprovalTarget = { memberId: string; taskId: string; generation: number; requestId: string };

export interface GroupsApi {
  /** the driver runs members' turns; without it a room can be read but nothing answers */
  driverReady(): Promise<boolean>;
  list(): Promise<Room[]>;
  /** a fresh room; the id is minted here (or passed) so a retried call lands on the same room */
  create(name: string, bots: ReadonlyArray<Pick<Bot, 'name' | 'label'>>, roomId?: string): Promise<Room>;
  state(roomId: string): Promise<RoomState>;
  /** the newest `size` events, probing the log's end first when `latestSeq` is not known */
  tail(roomId: string, latestSeq?: number | null, size?: number): Promise<RoomRead>;
  /** everything after `since` (up to `through`, when given) */
  after(roomId: string, since: number, through?: number): Promise<RoomRead>;
  /** the events just before `beforeSeq`, for pulling older history in */
  earlier(roomId: string, beforeSeq: number): Promise<RoomRead>;
  /** `eventId` makes the append idempotent: sending the same id again returns the first event */
  send(roomId: string, eventId: string, body: string): Promise<GroupsSendResult>;
  stop(roomId: string): Promise<GroupsStopResult>;
  rename(roomId: string, name: string): Promise<GroupsRenameResult>;
  disband(roomId: string): Promise<GroupsDisbandResult>;
  approve(roomId: string, action: ApprovalTarget, choice: 'once' | 'deny'): Promise<GroupsApproveResult>;
  retry(roomId: string, taskId: string): Promise<GroupsRetryResult>;
}

export function createGroupsApi(rpc: GroupsRpc, profile: () => string, newId: () => string): GroupsApi {
  /** events after `since`, page by page, until the log is read through or `through` is reached */
  async function readLog(roomId: string, since: number, through = Number.POSITIVE_INFINITY): Promise<RoomRead> {
    const events: RoomEvent[] = [];
    let cursor = since;
    for (;;) {
      const page = await rpc('groups.log', { profile: profile(), room_id: roomId, since_seq: cursor, limit: PAGE });
      for (const event of page.events) if (event.seq <= through) events.push(event);
      if (!page.has_more || page.cursor >= through) return { events, latestSeq: page.latest_seq };
      if (page.cursor <= cursor) throw new Error('The room log did not advance.');
      cursor = page.cursor;
    }
  }

  return {
    /** the driver runs members' turns; without it a room can be read but nothing answers */
    async driverReady(): Promise<boolean> {
      const capabilities = await rpc('groups.capabilities', { profile: profile() });
      return capabilities.driver === true;
    },

    async list(): Promise<Room[]> {
      const rooms: Room[] = [];
      let offset = 0;
      for (;;) {
        const page = await rpc('groups.list', { profile: profile(), limit: 100, offset });
        rooms.push(...page.rooms);
        const next = page.next_offset;
        if (next == null) return rooms;
        if (!Number.isSafeInteger(next) || next <= offset) throw new Error('The group list did not advance.');
        offset = next;
      }
    },

    /** a fresh room; the id is minted here so a retried call lands on the same room */
    async create(name: string, bots: ReadonlyArray<Pick<Bot, 'name' | 'label'>>, roomId = newId()): Promise<Room> {
      const problem = newGroupProblem(bots);
      if (problem) throw new Error(problem);
      const trimmed = name.trim().slice(0, MAX_GROUP_NAME);
      if (!trimmed) throw new Error('A group needs a name.');
      const { room } = await rpc('groups.create', { profile: profile(), room_id: roomId, name: trimmed, members: bots.map(memberInput) });
      return room;
    },

    async state(roomId: string): Promise<RoomState> {
      const result = await rpc('groups.state', { profile: profile(), room_id: roomId });
      return { room: result.room, driver: result.driver_status ?? null };
    },

    /** the newest events: from `latestSeq - TAIL_EVENTS`, probing the log's end first when it is not known */
    async tail(roomId: string, latestSeq?: number | null, size = TAIL_EVENTS): Promise<RoomRead> {
      let latest = latestSeq;
      if (latest == null) latest = (await rpc('groups.log', { profile: profile(), room_id: roomId, since_seq: 0, limit: 1 })).latest_seq;
      return readLog(roomId, Math.max(0, latest - size));
    },

    /** everything after `since` */
    after: readLog,

    /** the events just before `beforeSeq`, for pulling older history in */
    async earlier(roomId: string, beforeSeq: number): Promise<RoomRead> {
      return readLog(roomId, Math.max(0, beforeSeq - 1 - TAIL_EVENTS), beforeSeq - 1);
    },

    /** `eventId` makes the append idempotent: sending the same id again returns the first event */
    send: (roomId: string, eventId: string, body: string) =>
      rpc('groups.send', { profile: profile(), room_id: roomId, event_id: eventId, payload: { text: body, thread_id: eventId } }),

    stop: (roomId: string) => rpc('groups.stop', { profile: profile(), room_id: roomId, cancel_id: newId() }),

    rename: (roomId: string, name: string) => rpc('groups.rename', { profile: profile(), room_id: roomId, event_id: newId(), name: name.trim().slice(0, MAX_GROUP_NAME) }),

    disband: (roomId: string) => rpc('groups.disband', { profile: profile(), room_id: roomId, cancel_id: newId() }),

    approve: (roomId: string, action: { memberId: string; taskId: string; generation: number; requestId: string }, choice: 'once' | 'deny') =>
      rpc('groups.approve', {
        profile: profile(),
        room_id: roomId,
        member_id: action.memberId,
        task_id: action.taskId,
        execution_generation: action.generation,
        choice,
        request_id: action.requestId,
      }),

    retry: (roomId: string, taskId: string) => rpc('groups.retry', { profile: profile(), room_id: roomId, task_id: taskId }),
  };
}
