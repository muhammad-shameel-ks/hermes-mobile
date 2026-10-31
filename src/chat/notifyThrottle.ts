/**
 * Paces how often the store tells its subscribers it changed.
 *
 * A reply streams dozens of deltas a second, and every notification re-renders
 * the subscribed tree on the one JS thread that also has to answer taps. The
 * state itself is always current (`getSnapshot` never lags); only the wake-up
 * is paced: the first change after a quiet spell notifies at once, the rest
 * share one trailing notification per interval.
 *
 * The interval stretches with what the last streamed notification cost to render, so
 * however heavy the tree gets the thread keeps most of its time free for input.
 * The cost is read from the microtask that follows the listeners: React flushes
 * a `useSyncExternalStore` update in a microtask queued from inside them. Only
 * paced notifications are sampled: an edge (a tool starting or finishing, a send)
 * mounts rows once and says nothing about what the next streamed beat will cost,
 * so it would only stretch the first beats of the text after it.
 */

export type ThrottleClock = {
  now(): number;
  after(ms: number, run: () => void): () => void;
  microtask(run: () => void): void;
};

export const realClock: ThrottleClock = {
  now: () => Date.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  microtask: (run) => queueMicrotask(run),
};

/** the shortest gap between two streamed notifications: 20 a second at most */
export const STREAM_NOTIFY_MS = 50;
/** the longest the gap stretches to, however slow a render gets */
export const STREAM_NOTIFY_MAX_MS = 250;
/** the gap is the last render's cost times this, so a render takes a third of the thread at most */
export const COST_FACTOR = 3;

export class NotifyThrottle {
  private readonly notify: () => void;
  private readonly clock: ThrottleClock;
  private lastAt = Number.NEGATIVE_INFINITY;
  private cost = 0;
  private cancelPending: (() => void) | null = null;

  constructor(notify: () => void, clock: ThrottleClock = realClock) {
    this.notify = notify;
    this.clock = clock;
  }

  /** the gap the next streamed notification keeps from the last one */
  get interval(): number {
    return Math.min(STREAM_NOTIFY_MAX_MS, Math.max(STREAM_NOTIFY_MS, this.cost * COST_FACTOR));
  }

  get pending(): boolean {
    return this.cancelPending !== null;
  }

  /** state changed in a way that may wait for the next beat */
  request() {
    if (this.cancelPending) return;
    const wait = this.lastAt + this.interval - this.clock.now();
    if (wait <= 0) {
      this.fire(true);
      return;
    }
    this.cancelPending = this.clock.after(wait, () => {
      this.cancelPending = null;
      this.fire(true);
    });
  }

  /** notify now, taking over any wait in progress */
  flush() {
    this.cancel();
    this.fire(false);
  }

  cancel() {
    this.cancelPending?.();
    this.cancelPending = null;
  }

  private fire(sample: boolean) {
    const start = this.clock.now();
    this.lastAt = start;
    this.notify();
    if (!sample) return;
    // quick to notice a slow render, slow to forget it
    this.clock.microtask(() => {
      this.cost = Math.max(this.clock.now() - start, this.cost / 2);
    });
  }
}
