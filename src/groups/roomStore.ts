/**
 * One open group chat: its log, driver status and the writes the reader makes. The gateway pushes no room
 * events, so the store polls while it is started (the desktop's canonical room view polls every 2 s); it
 * quickens while the driver works and slows when the room is quiet, and does nothing while the socket is
 * down. A screen starts it on mount and stops it on unmount, so a closed room costs no traffic.
 *
 * Framework-free: `useRoom` is the React edge.
 */

import type { RoomDriverStatus, RoomEvent } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { errorText } from '../gateway/http.ts';
import { isDefinitive, isRoomGone, type ApprovalTarget, type GroupsApi } from './api.ts';
import { mergeEvents, toGroupRoom, type GroupRoom, type LabelOf } from './rooms.ts';

export type RoomPhase = 'loading' | 'ready' | 'gone' | 'error';

/** a send whose answer never came: the exact event, held so a retry lands on the same one */
export type Unsent = { eventId: string; text: string };

export type RoomSnapshot = {
  phase: RoomPhase;
  room: GroupRoom | null;
  /** ascending by seq; the newest window, with older pages pulled in on request */
  events: readonly RoomEvent[];
  /** older history exists beyond `events` */
  more: boolean;
  loadingEarlier: boolean;
  /** null while the gateway reports no driver for the room: it can be read, nothing will answer */
  driver: RoomDriverStatus | null;
  /** the last poll's failure, cleared by the next success */
  readError: string | null;
  /** the last write's failure */
  actionError: string | null;
  sending: boolean;
  unsent: Unsent | null;
  /** a stop, approval, retry, rename or disband is in flight */
  busy: boolean;
};

/** `sent`: appended. `rejected`: the gateway refused, the text is still the reader's. `unconfirmed`: no answer; see `unsent`. */
export type SendOutcome = 'sent' | 'rejected' | 'unconfirmed' | 'blocked' | 'empty';

export type RoomClock = (ms: number, run: () => void) => () => void;

export type RoomStoreOptions = {
  /** the roster's current name for a profile */
  labelOf?: LabelOf;
  /** polling waits while this is false (the socket is down or the app is in the background) */
  online: () => boolean;
  newId: () => string;
  /** unconfirmed sends, kept by the caller so they outlive this screen */
  journal: Map<string, Unsent>;
  /** the room's name changed or it was disbanded: the roster should reread */
  onRoomChanged?: () => void;
  after?: RoomClock;
};

const WORKING_POLL_MS = 1500;
const QUIET_POLL_MS = 4000;
const ERROR_POLL_MS = 6000;

const defaultAfter: RoomClock = (ms, run) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export class RoomStore {
  private snapshot: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly after: RoomClock;
  private readonly api: GroupsApi;
  private readonly options: RoomStoreOptions;
  readonly roomId: string;
  private cancelPoll: (() => void) | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private started = false;

  constructor(api: GroupsApi, roomId: string, options: RoomStoreOptions) {
    this.api = api;
    this.roomId = roomId;
    this.options = options;
    this.after = options.after ?? defaultAfter;
    this.snapshot = {
      phase: 'loading',
      room: null,
      events: [],
      more: false,
      loadingEarlier: false,
      driver: null,
      readError: null,
      actionError: null,
      sending: false,
      unsent: options.journal.get(roomId) ?? null,
      busy: false,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<RoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.refresh();
  }

  stop() {
    this.started = false;
    this.cancelPoll?.();
    this.cancelPoll = null;
  }

  /** one read of the room now; a poll already running is followed by another, so the caller sees what it just wrote */
  refresh(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    const run = async () => {
      do {
        this.again = false;
        await this.pull();
      } while (this.again && this.started);
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
      this.schedule();
    });
    return this.inflight;
  }

  private schedule() {
    this.cancelPoll?.();
    this.cancelPoll = null;
    if (!this.started || this.snapshot.phase === 'gone') return;
    const wait = this.snapshot.readError ? ERROR_POLL_MS : this.snapshot.driver?.working ? WORKING_POLL_MS : QUIET_POLL_MS;
    this.cancelPoll = this.after(wait, () => void this.refresh());
  }

  private async pull() {
    if (!this.options.online()) return;
    try {
      const state = await this.api.state(this.roomId);
      const room = toGroupRoom(state.room, this.options.labelOf);
      if (room.disbanded) {
        this.set({ phase: 'gone', room, driver: null, readError: null });
        return;
      }
      let { events, more } = this.snapshot;
      if (events.length === 0) {
        const tail = await this.api.tail(this.roomId, state.room.latest_seq);
        events = tail.events;
        more = events.length > 0 && events[0].seq > 1;
      } else {
        events = mergeEvents(events, (await this.api.after(this.roomId, events[events.length - 1].seq)).events);
      }
      const renamed = this.snapshot.room !== null && this.snapshot.room.name !== room.name;
      this.set({ phase: 'ready', room, events, more, driver: state.driver, readError: null });
      if (renamed) this.options.onRoomChanged?.();
    } catch (error) {
      if (isRoomGone(error)) this.set({ phase: 'gone', readError: null, driver: null });
      else this.set({ phase: this.snapshot.room ? this.snapshot.phase : 'error', readError: errorText(error) });
    }
  }

  async loadEarlier() {
    const first = this.snapshot.events[0];
    if (!first || !this.snapshot.more || this.snapshot.loadingEarlier) return;
    this.set({ loadingEarlier: true });
    try {
      const page = await this.api.earlier(this.roomId, first.seq);
      const events = mergeEvents(this.snapshot.events, page.events);
      this.set({ events, more: events.length > 0 && events[0].seq > 1, loadingEarlier: false });
    } catch (error) {
      this.set({ loadingEarlier: false, actionError: errorText(error) });
    }
  }

  // ─── writes ───────────────────────────────────────────────────────────────

  private setUnsent(unsent: Unsent | null) {
    if (unsent) this.options.journal.set(this.roomId, unsent);
    else this.options.journal.delete(this.roomId);
    this.set({ unsent });
  }

  /** appends the reader's message; refused while an earlier send is unconfirmed (retry that one first) */
  async send(body: string): Promise<SendOutcome> {
    const text = body.trim();
    if (!text) return 'empty';
    if (this.snapshot.unsent || this.snapshot.sending) return 'blocked';
    return this.deliver({ eventId: this.options.newId(), text });
  }

  /** sends the unconfirmed message again under its own event id, so it cannot land twice */
  async retryUnsent(): Promise<SendOutcome> {
    const unsent = this.snapshot.unsent;
    if (!unsent || this.snapshot.sending) return 'blocked';
    return this.deliver(unsent);
  }

  private async deliver(unsent: Unsent): Promise<SendOutcome> {
    this.set({ sending: true, actionError: null });
    try {
      await this.api.send(this.roomId, unsent.eventId, unsent.text);
    } catch (error) {
      if (isDefinitive(error)) {
        this.setUnsent(null);
        this.set({ sending: false, actionError: errorText(error) });
        return 'rejected';
      }
      this.setUnsent(unsent);
      this.set({ sending: false, actionError: errorText(error) });
      return 'unconfirmed';
    }
    this.setUnsent(null);
    this.set({ sending: false });
    void this.refresh();
    return 'sent';
  }

  /** a write that changes what the driver is doing; the room is reread after it either way */
  private async act(work: () => Promise<unknown>): Promise<boolean> {
    if (this.snapshot.busy) return false;
    this.set({ busy: true, actionError: null });
    let ok = true;
    try {
      await work();
    } catch (error) {
      ok = false;
      this.set({ actionError: errorText(error) });
    }
    this.set({ busy: false });
    void this.refresh();
    return ok;
  }

  stopRun() {
    return this.act(() => this.api.stop(this.roomId));
  }

  approve(action: ApprovalTarget, choice: 'once' | 'deny') {
    return this.act(() => this.api.approve(this.roomId, action, choice));
  }

  retryTask(taskId: string) {
    return this.act(() => this.api.retry(this.roomId, taskId));
  }

  async rename(name: string) {
    const ok = await this.act(() => this.api.rename(this.roomId, name));
    if (ok) this.options.onRoomChanged?.();
    return ok;
  }

  async disband() {
    const ok = await this.act(() => this.api.disband(this.roomId));
    if (ok) {
      this.set({ phase: 'gone' });
      this.options.onRoomChanged?.();
    }
    return ok;
  }
}
