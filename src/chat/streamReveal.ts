/**
 * How a streamed reply's text shows: a *head* sweeps through the source at the stream's own pace,
 * characters behind it fade from clear to full ink, and characters ahead of it are laid out but clear.
 *
 * Text reaches the screen unevenly. The store wakes React on a beat that stretches with render cost
 * (notifyThrottle.ts), the markdown pass is deferred and lands when the thread is free, and the
 * gateway's own chunks vary in size. Painting each arrival as it lands shows those steps as chunks.
 * Instead each arrival plans the head to reach the new end by the time the next arrival is due (the
 * recent gap between arrivals). The head therefore moves at the arrival rate, speeds up when text
 * arrives early and waits at the known end when the stream stalls. It is never more than
 * `REVEAL_MAX_MS` behind the newest text, and settling flushes it to the end at once.
 *
 * The reveal covers a whole reply's source (every block of it), so blocks show in order. It is
 * arithmetic over source lengths and clock time; `fadeTail` (streamFade.ts) paints the result, and
 * `revealClock` is the one timer that repaints every reply still revealing or fading.
 */

import type { FadeSpan } from './streamFade.ts';

/** how long a character takes to reach full ink once the head has passed it */
export const FADE_MS = 320;
/** alpha is painted in these steps: it bounds the distinct colours (and their memo entries) a fade mints */
const STEPS = 10;
/** the repaint period while a reply reveals or fades, and the shortest sweep an arrival is planned over */
export const REVEAL_TICK_MS = 50;
/** the longest sweep: the head reaches the newest text within this of its arrival, however long the stream paused */
export const REVEAL_MAX_MS = 300;
/** how far each measured gap moves the expected one */
const GAP_WEIGHT = 0.3;

/**
 * Where each alpha step begins, as a fraction of `FADE_MS` since the head passed a character. The
 * alpha is the ease-out `1 - (1 - x)²` rounded to tenths, so step `k` starts where that reaches
 * `k - 0.5` tenths: the edge shows most of its ink early and reads as arriving, not as lagging.
 */
const STEP_STARTS = Array.from({ length: STEPS + 1 }, (_, k) => (k === 0 ? 0 : 1 - Math.sqrt(1 - (k - 0.5) / STEPS)));

/** the alpha a character shows `elapsed` ms after the head passed it */
export function alphaAt(elapsed: number): number {
  const progress = Math.min(1, Math.max(0, elapsed / FADE_MS));
  return Math.round((1 - (1 - progress) ** 2) * STEPS) / STEPS;
}

/** the head was at `pos` at `at`; between two knots it moves linearly */
type Knot = { at: number; pos: number };

export class StreamReveal {
  /** the source length known so far */
  private length = 0;
  /** the head's path over the last `FADE_MS` and its plan ahead; empty once everything is solid */
  private knots: Knot[] = [];
  /** when the last arrival was recorded, or null before the first */
  private arrivedAt: number | null = null;
  /** the gap expected before the next arrival */
  private gap = REVEAL_TICK_MS;

  /** whether anything has been recorded: a reply first seen streaming records its first arrival in render, so its first commit already fades */
  get started(): boolean {
    return this.arrivedAt !== null;
  }

  /**
   * The source reached `length` at `now` while streaming. A first arrival shows at once and fades in
   * whole; later ones are swept in by the time the next is due; a source that shrank was rewritten
   * and paints solid.
   */
  arrive(length: number, now: number): void {
    if (length === this.length && this.arrivedAt !== null) return;
    if (this.arrivedAt === null) {
      this.arrivedAt = now;
      this.length = length;
      this.knots = length > 0 ? [{ at: now, pos: 0 }, { at: now, pos: length }] : [];
      return;
    }
    if (length < this.length) {
      this.solid(length, now);
      return;
    }
    const measured = Math.min(REVEAL_MAX_MS, Math.max(REVEAL_TICK_MS, now - this.arrivedAt));
    this.gap += (measured - this.gap) * GAP_WEIGHT;
    this.arrivedAt = now;
    this.plan(length, now, now + this.gap);
  }

  /**
   * The reply stopped streaming at `length`: whatever the head had left shows now and fades in. Text
   * that never streamed here (or shrank) paints solid.
   */
  settle(length: number, now: number): void {
    if (this.arrivedAt === null || length < this.length) this.solid(length, now);
    else if (length > this.length || this.head(now) < this.length) this.plan(length, now, now);
  }

  /** where the head is at `at`, in source characters */
  head(at: number): number {
    const knots = this.knots;
    if (knots.length === 0) return this.length;
    if (at < knots[0].at) return knots[0].pos;
    let index = knots.length - 1;
    while (index > 0 && knots[index].at > at) index--;
    if (index === knots.length - 1) return knots[index].pos;
    const from = knots[index];
    const to = knots[index + 1];
    return from.pos + ((to.pos - from.pos) * (at - from.at)) / (to.at - from.at);
  }

  /** whether anything is still clear or fading at `now` */
  animating(now: number): boolean {
    this.prune(now);
    return this.knots.length > 0;
  }

  /**
   * The still-clear and still-fading characters of the source range `[start, end)` at `now`, as
   * `fadeTail` takes them: newest first, counted back from `end`. Empty once the range is solid.
   */
  spans(start: number, end: number, now: number): FadeSpan[] {
    const spans: FadeSpan[] = [];
    if (this.knots.length === 0 || end <= start) return spans;
    const push = (from: number, to: number, alpha: number) => {
      const chars = Math.min(to, end) - Math.max(from, start);
      if (chars <= 0) return;
      const last = spans[spans.length - 1];
      if (last && last.alpha === alpha) last.chars += chars;
      else spans.push({ chars, alpha });
    };
    let to = Math.round(this.head(now));
    push(to, end, 0);
    for (let step = 1; step <= STEPS && to > start; step++) {
      const from = Math.round(this.head(now - STEP_STARTS[step] * FADE_MS));
      push(from, to, (step - 1) / STEPS);
      to = from;
    }
    return spans;
  }

  /** everything up to `length` paints solid from `now` */
  private solid(length: number, now: number) {
    this.length = length;
    this.knots = [];
    this.arrivedAt = now;
  }

  /** the head keeps its path up to `now`, then moves to `length` by `until` */
  private plan(length: number, now: number, until: number) {
    const head = this.head(now);
    if (this.knots.length === 0) this.knots.push({ at: now, pos: this.length });
    while (this.knots.length > 0 && this.knots[this.knots.length - 1].at > now) this.knots.pop();
    const last = this.knots[this.knots.length - 1];
    if (!last || last.at < now || last.pos !== head) this.knots.push({ at: now, pos: head });
    this.knots.push({ at: until, pos: length });
    this.length = length;
    this.prune(now);
  }

  /** forget the path the fade no longer reads; once the head is home and solid, forget it all */
  private prune(now: number) {
    const knots = this.knots;
    const solidBefore = now - FADE_MS;
    while (knots.length > 1 && knots[1].at <= solidBefore) knots.shift();
    const last = knots[knots.length - 1];
    if (last && last.at <= solidBefore && last.pos >= this.length) knots.length = 0;
  }
}

export type RevealHost = {
  now(): number;
  after(ms: number, run: () => void): () => void;
};

export const realRevealHost: RevealHost = {
  now: () => performance.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export type RevealClock = {
  now(): number;
  /** hear every tick until the returned function is called */
  subscribe(listener: (now: number) => void): () => void;
  /** no ticks while the app is in the background; the reveal is clock time, so it is simply further on when they resume */
  setForeground(foreground: boolean): void;
};

/**
 * One repaint timer for every reply still revealing or fading: listeners hear each tick while they
 * are subscribed, and the timer stops when the last one leaves or the app goes to the background.
 * React batches the repaints a tick causes into one commit.
 */
export function createRevealClock(host: RevealHost = realRevealHost): RevealClock {
  const listeners = new Set<(now: number) => void>();
  let cancel: (() => void) | null = null;
  let foreground = true;
  const stop = () => {
    cancel?.();
    cancel = null;
  };
  const arm = () => {
    if (foreground && listeners.size > 0) cancel ??= host.after(REVEAL_TICK_MS, tick);
  };
  const tick = () => {
    cancel = null;
    const now = host.now();
    for (const listener of [...listeners]) listener(now);
    arm();
  };
  return {
    now: () => host.now(),
    subscribe(listener) {
      listeners.add(listener);
      arm();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    setForeground(next) {
      foreground = next;
      if (foreground) arm();
      else stop();
    },
  };
}

export const revealClock = createRevealClock();
