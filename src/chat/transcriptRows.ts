/**
 * What each transcript row renders, kept outside React so a streamed token touches only the rows it
 * changes. A row's view is its message, its action-bar plan and whether it is the newest message;
 * `sync` takes the open transcript's messages and replans only from the first changed message (the
 * whole thread when the turn starts or ends, because `running` gates the bars), reusing every view
 * whose three inputs are unchanged. Rows subscribe by id and re-render only when their own view moved.
 *
 * Costs per delta: O(n) reference compares to find the first changed message, then O(tail) planning.
 * The old per-delta pass planned, stringified and rebuilt every message.
 */

import { planBars, type BarPlan } from './actionBar.ts';
import type { Message } from './transcript.ts';

export type RowView = { message: Message; bar: BarPlan | undefined; latest: boolean };

export function samePlan(a: BarPlan, b: BarPlan): boolean {
  if (a.kind === 'user') return b.kind === 'user' && a.latest === b.latest && a.stop === b.stop;
  return b.kind === 'assistant' && a.live === b.live && a.fullAvailable === b.fullAvailable;
}

/** the first index where the two lists hold different message objects (the shorter length when one is a prefix of the other) */
export function firstChanged(before: readonly Message[], after: readonly Message[]): number {
  const shared = Math.min(before.length, after.length);
  let i = 0;
  while (i < shared && before[i] === after[i]) i += 1;
  return i;
}

const latestUserIndex = (messages: readonly Message[]): number => {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === 'user') return i;
  return -1;
};

/**
 * Where replanning must begin. Plans before the first changed message hold, except the newest user
 * turn's (its `latest` and `stop` follow the newest user message, old or new) and any reply run that
 * straddles the change (a run is planned as a whole).
 */
export function replanStart(before: readonly Message[], after: readonly Message[]): number {
  let start = firstChanged(before, after);
  // a reply run is planned as a whole: one the change touches starts over from its first reply
  while (start > 0 && after[start - 1].role === 'assistant') start -= 1;
  // a user message closes the run before it, so these need no such step back
  const oldUser = latestUserIndex(before);
  const newUser = latestUserIndex(after);
  if (oldUser >= 0) start = Math.min(start, oldUser);
  if (newUser >= 0) start = Math.min(start, newUser);
  return start;
}

export class TranscriptRows {
  private messages: readonly Message[] = [];
  private running = false;
  private readonly plans = new Map<string, BarPlan>();
  private readonly rows = new Map<string, RowView>();
  private readonly dirty = new Set<string>();
  private readonly listeners = new Map<string, Set<() => void>>();

  /** Bring the views up to date. Idempotent per (messages, running); safe to call during render. */
  sync(messages: readonly Message[], running: boolean): void {
    if (messages === this.messages && running === this.running) return;
    const before = this.messages;
    const wasRunning = this.running;
    this.messages = messages;
    this.running = running;
    if (running === wasRunning && firstChanged(before, messages) === before.length && before.length === messages.length) return;

    const start = running !== wasRunning ? 0 : replanStart(before, messages);
    this.replan(before, messages, start, running);
    this.refresh(before, messages, Math.max(0, Math.min(start, before.length - 1, messages.length - 1)));
  }

  private replan(before: readonly Message[], messages: readonly Message[], start: number, running: boolean) {
    const old = new Map<string, BarPlan>();
    for (let i = start; i < before.length; i += 1) {
      const plan = this.plans.get(before[i].id);
      if (plan) old.set(before[i].id, plan);
      this.plans.delete(before[i].id);
    }
    if (start >= messages.length) return;
    for (const [id, plan] of planBars(start === 0 ? messages : messages.slice(start), running)) {
      const earlier = old.get(id);
      this.plans.set(id, earlier && samePlan(earlier, plan) ? earlier : plan);
    }
  }

  private refresh(before: readonly Message[], messages: readonly Message[], from: number) {
    const earlier = new Map<string, RowView>();
    for (let i = from; i < before.length; i += 1) {
      const view = this.rows.get(before[i].id);
      if (view) earlier.set(before[i].id, view);
      this.rows.delete(before[i].id);
    }
    const last = messages.length - 1;
    for (let i = from; i < messages.length; i += 1) {
      const message = messages[i];
      const bar = this.plans.get(message.id);
      const latest = i === last;
      const view = earlier.get(message.id);
      if (view && view.message === message && view.bar === bar && view.latest === latest) {
        this.rows.set(message.id, view);
      } else {
        this.rows.set(message.id, { message, bar, latest });
        this.dirty.add(message.id);
      }
      earlier.delete(message.id);
    }
    for (const id of earlier.keys()) this.dirty.add(id);
  }

  get = (id: string): RowView | undefined => this.rows.get(id);

  /** Tell the rows whose view moved since the last flush. Call after commit, never during render. */
  flush(): void {
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) for (const listener of [...(this.listeners.get(id) ?? [])]) listener();
  }

  subscribe = (id: string, listener: () => void): (() => void) => {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(id) === set) this.listeners.delete(id);
    };
  };
}
