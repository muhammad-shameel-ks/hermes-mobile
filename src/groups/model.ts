/**
 * The phone's group chats as the drawer and the room screens see them: the roster of rooms (the gateway's
 * `groups.list`, each with a preview of its newest message), creating, and the live store for one open room.
 *
 * Its own store beside the chat controller's: rooms ride a different protocol (a polled event log, not a
 * session's event stream), and a room's activity must not wake the transcript's subscribers.
 */

import { JSON_RPC_METHOD_NOT_FOUND, JsonRpcGatewayError } from '../../vendor/hermes-shared/src/json-rpc-channel.ts';
import type { Bot } from '../bots/roster.ts';
import { dataEqual, shallowEqual, shallowEqualArray } from '../chat/selector.ts';
import { errorText } from '../gateway/http.ts';
import type { GroupsApi } from './api.ts';
import { RoomStore, type Unsent } from './roomStore.ts';
import { roomPreview, toGroupRoom, type GroupRoom, type LabelOf } from './rooms.ts';

export type GroupRow = { room: GroupRoom; preview: string };

export type GroupsState = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** whether the gateway runs rooms: null until asked, false when it has no group driver (or predates groups) */
  driver: boolean | null;
  /** newest change first, as the gateway lists them */
  rows: GroupRow[];
};

export const emptyGroups: GroupsState = { loaded: false, loading: false, error: null, driver: null, rows: [] };

/** the rooms whose previews load after a list: the ones the drawer shows first */
const PREVIEW_ROOMS = 12;
const PREVIEW_EVENTS = 12;

export type GroupsModelDeps = {
  api: GroupsApi;
  /** the socket is open; reads wait while it is not */
  online: () => boolean;
  labelOf: LabelOf;
  newId: () => string;
};

export class GroupsModel {
  private state: GroupsState = emptyGroups;
  private readonly listeners = new Set<() => void>();
  private readonly deps: GroupsModelDeps;
  readonly api: GroupsApi;
  /** unconfirmed sends by room, so one outlives the screen that made it */
  private readonly journal = new Map<string, Unsent>();
  /** `roomId:updatedAt` of the log a row's preview was read from */
  private readonly previewed = new Map<string, string>();
  private refreshing: Promise<void> | null = null;

  constructor(deps: GroupsModelDeps) {
    this.deps = deps;
    this.api = deps.api;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** a write that changes nothing (a refresh of an unchanged list) wakes no one */
  private set(patch: Partial<GroupsState>) {
    const next = { ...this.state, ...patch };
    if (shallowEqual(next, this.state)) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** a rooms list that keeps the previews it already has, and every unchanged row by identity */
  private rowsFrom(rooms: GroupRoom[]): GroupRow[] {
    const known = new Map(this.state.rows.map((row) => [row.room.id, row]));
    const rows = rooms.map((room) => {
      const old = known.get(room.id);
      return old && dataEqual(old.room, room) ? old : { room, preview: old?.preview ?? '' };
    });
    return shallowEqualArray(rows, this.state.rows) ? this.state.rows : rows;
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async load() {
    if (!this.deps.online()) return;
    this.set({ loading: true });
    try {
      const driver = await this.deps.api.driverReady();
      const rooms = driver ? (await this.deps.api.list()).map((room) => toGroupRoom(room, this.deps.labelOf)).filter((room) => !room.disbanded) : [];
      this.set({ loaded: true, loading: false, error: null, driver, rows: this.rowsFrom(rooms) });
    } catch (error) {
      // a gateway that predates rooms has no `groups.*` methods: that is "unavailable", not a failure to retry
      if (error instanceof JsonRpcGatewayError && error.code === JSON_RPC_METHOD_NOT_FOUND) {
        this.set({ loaded: true, loading: false, error: null, driver: false, rows: [] });
        return;
      }
      this.set({ loading: false, error: errorText(error) });
      return;
    }
    void this.loadPreviews();
  }

  /** previews for the first rooms whose log moved since they were read, one room at a time */
  private async loadPreviews() {
    for (const { room } of this.state.rows.slice(0, PREVIEW_ROOMS)) {
      const stamp = `${room.id}:${room.updatedAt}`;
      if (this.previewed.get(room.id) === stamp) continue;
      try {
        const { events } = await this.deps.api.tail(room.id, room.latestSeq, PREVIEW_EVENTS);
        this.previewed.set(room.id, stamp);
        const preview = roomPreview(events, room.members);
        this.set({ rows: this.state.rows.map((row) => (row.room.id === room.id && row.preview !== preview ? { ...row, preview } : row)) });
      } catch {
        // a row without a preview is still a row; the next refresh tries again
      }
    }
  }

  /** creates a room and puts it at the head of the roster */
  async create(name: string, bots: ReadonlyArray<Pick<Bot, 'name' | 'label'>>): Promise<GroupRoom> {
    const room = toGroupRoom(await this.deps.api.create(name, bots), this.deps.labelOf);
    this.set({ rows: [{ room, preview: '' }, ...this.state.rows.filter((row) => row.room.id !== room.id)], driver: true });
    return room;
  }

  /** the live store for one room; the caller starts and stops it */
  open(roomId: string): RoomStore {
    return new RoomStore(this.deps.api, roomId, {
      labelOf: this.deps.labelOf,
      online: this.deps.online,
      newId: this.deps.newId,
      journal: this.journal,
      onRoomChanged: () => void this.refresh(),
    });
  }

  /** a roster action on a room that is not open */
  async disband(roomId: string) {
    await this.deps.api.disband(roomId);
    this.journal.delete(roomId);
    this.set({ rows: this.state.rows.filter((row) => row.room.id !== roomId) });
  }

  async rename(roomId: string, name: string) {
    await this.deps.api.rename(roomId, name);
    await this.refresh();
  }
}
