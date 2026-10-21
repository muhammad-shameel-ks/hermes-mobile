/**
 * A read the kanban screens keep fresh while they are on screen: the board, a task's detail, its worker log.
 * The desktop rides the plugin's `/events` socket and polls as a fallback; the phone polls only, while the
 * screen is mounted and the app is in the foreground (the screen starts and stops it).
 *
 * Writes paint first: `update` applies an optimistic edit and `restore` rolls it back. Either one discards a
 * read that was already in flight, so a poll that left before the write cannot repaint the old state; the
 * caller refreshes once the write lands. Framework-free: `useLive` is the React edge.
 */

import type { KanbanClock } from './rest.ts';

export type LiveSnapshot<T> = {
  data: T | null;
  /** the last read's failure, cleared by the next success; earlier data stays */
  error: unknown;
  /** a read is in flight */
  loading: boolean;
};

export type LiveOptions<T> = {
  load: () => Promise<T>;
  /** the gap after a read before the next one, asked after each read so it can follow the data */
  intervalMs: (data: T | null) => number;
  after?: KanbanClock;
};

const defaultAfter: KanbanClock = (ms, run) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export class LiveResource<T> {
  private snapshot: LiveSnapshot<T> = { data: null, error: null, loading: false };
  private readonly listeners = new Set<() => void>();
  private readonly options: LiveOptions<T>;
  private readonly after: KanbanClock;
  private cancelPoll: (() => void) | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private started = false;
  /** bumped by every local write, so a read that started before it is dropped */
  private version = 0;

  constructor(options: LiveOptions<T>) {
    this.options = options;
    this.after = options.after ?? defaultAfter;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<LiveSnapshot<T>>) {
    const next = { ...this.snapshot, ...patch };
    if (next.data === this.snapshot.data && next.error === this.snapshot.error && next.loading === this.snapshot.loading) return;
    this.snapshot = next;
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

  /** one read now; a read already running is followed by another, so the caller sees what it just wrote */
  refresh(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    const run = async () => {
      do {
        this.again = false;
        await this.pull();
      } while (this.again);
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
      this.schedule();
    });
    return this.inflight;
  }

  /** Paint an optimistic edit; returns what it replaced, for `restore`. Nothing happens before the first read. */
  update(edit: (data: T) => T): T | null {
    const previous = this.snapshot.data;
    if (previous === null) return null;
    this.version += 1;
    this.set({ data: edit(previous) });
    return previous;
  }

  /** roll an optimistic edit back */
  restore(data: T | null) {
    if (data === null) return;
    this.version += 1;
    this.set({ data });
  }

  private async pull() {
    const version = this.version;
    this.set({ loading: true });
    try {
      const data = await this.options.load();
      if (version !== this.version) {
        // a local write landed meanwhile: this answer predates it, so read again
        this.again = true;
        return;
      }
      this.set({ data, error: null, loading: false });
    } catch (error) {
      this.set({ error, loading: false });
    }
  }

  private schedule() {
    this.cancelPoll?.();
    this.cancelPoll = null;
    if (!this.started) return;
    this.cancelPoll = this.after(this.options.intervalMs(this.snapshot.data), () => {
      this.cancelPoll = null;
      void this.refresh();
    });
  }
}
