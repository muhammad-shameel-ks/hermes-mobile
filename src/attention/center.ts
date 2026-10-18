/**
 * Keeps the reader in reach of every open request, wherever they are.
 *
 * In the foreground, a request in a chat other than the open one rides the
 * attention banner (`items`). While the app is away every open request gets an
 * attention notification from the system, taken down as soon as the request
 * is answered, withdrawn or times out, and all of them once the app is back.
 *
 * Requests reach the phone only over its socket, so the socket has to outlive
 * the app leaving the foreground for any of that to fire. While a turn streams
 * or waits on the reader the center asks the platform for a background hold
 * (Android's foreground service) and keeps the socket open; once nothing is
 * left to wait for, or where no hold is granted, the socket closes as before.
 */

import type { ChatSnapshot } from '../chat/controller.ts';
import { shallowEqualArray } from '../chat/selector.ts';
import { ATTENTION_COPY, AttentionBoard, collectAttention, holdText, liveWork, type Attention } from './attention.ts';

export type AttentionNotifier = {
  post(item: Attention): void;
  dismiss(id: string): void;
};

/** a platform's way to keep the app running with its socket while away; `start` is false when it is refused */
export type BackgroundHold = {
  start(title: string, text: string): boolean;
  stop(): void;
};

export type AttentionDeps = {
  source: { subscribe(listener: () => void): () => void; getSnapshot(): ChatSnapshot };
  notifier: AttentionNotifier;
  /** null where the platform keeps nothing running in the background */
  hold: BackgroundHold | null;
  /** the controller's socket and store: `pause` closes the socket and saves, `flush` only saves */
  app: { pause(): void; resume(): void; flush(): void };
  active: boolean;
};

export class AttentionCenter {
  private readonly deps: AttentionDeps;
  private readonly board = new AttentionBoard();
  private readonly listeners = new Set<() => void>();
  /** what the system shows now, by attention id */
  private readonly posted = new Set<string>();
  /** what the reader waved off the banner; an attention that leaves is forgotten */
  private readonly dismissed = new Set<string>();
  private active: boolean;
  private holding: string | null = null;
  private items: readonly Attention[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(deps: AttentionDeps) {
    this.deps = deps;
    this.active = deps.active;
  }

  start() {
    this.unsubscribe ??= this.deps.source.subscribe(() => this.sync());
    this.sync();
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.release();
  }

  // ─── the banner's store ─────────────────────────────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** the banner's queue: open requests outside the open chat, oldest first */
  getItems = () => this.items;

  dismiss(id: string) {
    this.dismissed.add(id);
    this.sync();
  }

  // ─── foreground and background ──────────────────────────────────────────────

  foreground() {
    this.active = true;
    this.release();
    this.deps.app.resume();
    // the banner and the open chat's cards take over from the system
    for (const id of this.posted) this.deps.notifier.dismiss(id);
    this.posted.clear();
    this.sync();
  }

  background() {
    this.active = false;
    const text = holdText(liveWork(this.deps.source.getSnapshot()));
    if (text && this.deps.hold?.start(ATTENTION_COPY.holdTitle, text)) {
      this.holding = text;
      this.deps.app.flush();
    } else {
      this.deps.app.pause();
    }
    // what is already waiting is what the reader walked away from
    for (const item of this.board.list) this.post(item);
  }

  private release() {
    if (this.holding === null) return;
    this.holding = null;
    this.deps.hold?.stop();
  }

  private post(item: Attention) {
    if (this.posted.has(item.id)) return;
    this.posted.add(item.id);
    this.deps.notifier.post(item);
  }

  private sync() {
    const snapshot = this.deps.source.getSnapshot();
    const { arrived, left } = this.board.update(collectAttention(snapshot));
    for (const { id } of left) {
      this.dismissed.delete(id);
      if (this.posted.delete(id)) this.deps.notifier.dismiss(id);
    }
    if (!this.active) for (const item of arrived) this.post(item);

    if (this.holding !== null) {
      const text = holdText(liveWork(snapshot));
      if (text === null) {
        this.release();
        this.deps.app.pause();
      } else if (text !== this.holding && this.deps.hold?.start(ATTENTION_COPY.holdTitle, text)) {
        this.holding = text;
      }
    }

    const items = this.board.list.filter((item) => item.key !== snapshot.openKey && !this.dismissed.has(item.id));
    if (shallowEqualArray(items, this.items)) return;
    this.items = items;
    for (const listener of this.listeners) listener();
  }
}
