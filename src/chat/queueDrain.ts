/**
 * The queue's engine: what the desktop's use-composer-queue does around the
 * store - the drain lock, the send-then-remove sequence, bounded retries, send-now
 * and steer-now on a row. It owns no data; the host holds each session's queue
 * and answers the few questions a drain needs, so the engine runs against a
 * fake host in tests.
 *
 * `sweep` is the edge-independent auto-drain: call it whenever anything about a
 * session changes. It sends the head only when the session is idle, the queue is
 * not parked and the gateway is reachable, so a prompt queued on a phone never
 * fires while the socket is closed - it drains on the next open one.
 */

import {
  beginEdit,
  clearDrainFailures,
  drainHead,
  drainRetryMs,
  edit,
  endEdit,
  enqueue,
  isSteerable,
  MAX_AUTO_DRAIN_ATTEMPTS,
  nextQueueId,
  noteDrainFailure,
  park,
  promote,
  QUEUE_COPY,
  remove,
  shouldAutoDrain,
  unpark,
  type QueueEntry,
  type QueueState,
} from './queue.ts';

export type QueueHost = {
  queue(key: string): QueueState | undefined;
  setQueue(key: string, update: (queue: QueueState) => QueueState): void;
  /** a turn is running in the session */
  busy(key: string): boolean;
  /** a prompt can be sent now: the gateway is reachable and the session is loaded */
  ready(key: string): boolean;
  /** send as a new turn, or run it when it is a slash command; false when the gateway refused, in which case nothing is left in the transcript */
  send(key: string, text: string, displayText?: string): Promise<boolean>;
  /** redirect the running turn; false when it declined */
  steer(key: string, text: string): Promise<boolean>;
  interrupt(key: string): Promise<void>;
  notify(text: string): void;
  after(ms: number, run: () => void): () => void;
  now(): number;
};

export class QueueDriver {
  private readonly host: QueueHost;
  private readonly draining = new Set<string>();
  private readonly retries = new Map<string, () => void>();

  constructor(host: QueueHost) {
    this.host = host;
  }

  private change(key: string, update: (queue: QueueState) => QueueState) {
    this.host.setQueue(key, update);
  }

  private entry(key: string, id: string): QueueEntry | undefined {
    return this.host.queue(key)?.entries.find((entry) => entry.id === id);
  }

  enqueue(key: string, text: string, displayText?: string): string | null {
    if (!text.trim()) return null;
    const id = nextQueueId();
    this.change(key, (queue) => enqueue(queue, id, text, this.host.now(), displayText));
    // the turn may have ended while the text was being typed: an idle queue drains at once
    this.sweep(key);
    return id;
  }

  remove(key: string, id: string) {
    this.change(key, (queue) => remove(queue, id));
  }

  beginEdit(key: string, id: string) {
    this.change(key, (queue) => beginEdit(queue, id));
  }

  /** save a rewrite and close the editor; a blank rewrite is refused and leaves the editor open */
  saveEdit(key: string, id: string, text: string): boolean {
    if (!text.trim()) return false;
    this.change(key, (queue) => endEdit(edit(queue, id, text)));
    this.sweep(key);
    return true;
  }

  cancelEdit(key: string) {
    this.change(key, endEdit);
    this.sweep(key);
  }

  /** Stop: hold the queue back so the end of the turn does not roll into the next prompt */
  park(key: string) {
    this.change(key, park);
  }

  resume(key: string) {
    this.change(key, unpark);
    this.sweep(key);
  }

  /**
   * Send an entry now. Mid-turn it moves to the head and interrupts, and the
   * settle drain sends it - unparked first, since this interrupt exists to reach
   * the queue, unlike Stop. Idle, it is sent directly.
   */
  async sendNow(key: string, id: string): Promise<boolean> {
    const queue = this.host.queue(key);
    if (!queue || queue.editing === id || !this.entry(key, id)) return false;
    if (this.host.busy(key)) {
      this.change(key, (q) => unpark(promote(q, id)));
      await this.host.interrupt(key);
      return true;
    }
    this.change(key, (q) => clearDrainFailures(q, id));
    const sent = await this.drain(key, (q) => q.entries.find((entry) => entry.id === id));
    if (sent) this.sweep(key);
    else if (sent === false) this.host.notify('The queued message was not sent.');
    return sent === true;
  }

  /**
   * Deliver an entry as a mid-turn redirect: no interrupt, and the rest of the
   * queue is untouched. A refused redirect leaves the entry where it was, so the
   * words are never lost; only a delivered one consumes it.
   */
  async steerNow(key: string, id: string): Promise<boolean> {
    const queue = this.host.queue(key);
    const entry = this.entry(key, id);
    if (!queue || !entry || queue.editing === id || !this.host.busy(key) || !isSteerable(entry.text)) return false;
    const accepted = await this.host.steer(key, entry.text).catch(() => false);
    if (!accepted) return false;
    this.change(key, (q) => unpark(remove(q, id)));
    return true;
  }

  /** the auto-drain: send the head when the session is idle and the queue is open */
  sweep(key: string) {
    const queue = this.host.queue(key);
    if (!queue || queue.entries.length === 0) return;
    if (!shouldAutoDrain({ busy: this.host.busy(key), parked: queue.parked, length: queue.entries.length })) return;
    if (!this.host.ready(key) || this.draining.has(key) || this.retries.has(key)) return;
    const head = drainHead(queue);
    if (!head) return;
    void this.drain(key, (q) => q.entries.find((entry) => entry.id === head.id)).then((sent) => {
      if (sent === false) this.failed(key, head.id);
      else if (sent === true) this.sweep(key);
    });
  }

  private failed(key: string, id: string) {
    // hold the sweep off while the failure is recorded: recording it changes the queue, which sweeps
    this.retries.set(key, () => {});
    this.change(key, (queue) => noteDrainFailure(queue, id));
    const failures = this.entry(key, id)?.drainFailures ?? MAX_AUTO_DRAIN_ATTEMPTS;
    if (failures >= MAX_AUTO_DRAIN_ATTEMPTS) {
      this.retries.delete(key);
      this.host.notify(`${QUEUE_COPY.stuckTitle}. ${QUEUE_COPY.stuckBody}`);
      return;
    }
    this.retries.set(
      key,
      this.host.after(drainRetryMs(failures), () => {
        this.retries.delete(key);
        this.sweep(key);
      }),
    );
  }

  /** one send-then-remove under the session's drain lock; `null` when there was nothing to send */
  private async drain(key: string, pick: (queue: QueueState) => QueueEntry | undefined): Promise<boolean | null> {
    if (this.draining.has(key)) return false;
    this.draining.add(key);
    try {
      const queue = this.host.queue(key);
      const entry = queue && pick(queue);
      if (!entry) return null;
      if (!(await this.host.send(key, entry.text, entry.displayText))) return false;
      // a send that went through means the queue is flowing again: lift any park so the rest follow
      this.change(key, (q) => unpark(remove(q, entry.id)));
      return true;
    } catch {
      return false;
    } finally {
      this.draining.delete(key);
    }
  }

  dispose() {
    for (const cancel of this.retries.values()) cancel();
    this.retries.clear();
  }
}
