/**
 * Keeps each session's status stack current: runs the reducer over live events,
 * reads the gateway's own snapshots (process registry, subagent roster, session
 * controls) on open and when an event says they changed, and arms the timer that
 * retires finished rows. The state itself lives with the host, one per session.
 *
 * Desktop counterparts: use-message-stream's status projections, the
 * `refreshBackgroundProcesses` / `useSubagentSnapshot` / `refreshSessionControl`
 * reads, and `stopBackgroundProcess`.
 */

import type { RpcMethods } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { errorText } from '../gateway/http.ts';
import { emptyQueue, queueFrom, type QueueEntry, type QueueState } from './queue.ts';
import {
  applyControlSnapshot,
  applyGoalText,
  applyProcessList,
  applySubagentSnapshot,
  dismissBackground,
  hydrateStatus,
  isStatusEvent,
  markControlUnsupported,
  reduceStatus,
  resetBackground,
  STATUS_COPY,
  statusNextExpiry,
  emptyStatus,
  tickStatus,
  type StatusEvent,
  type StatusState,
} from './statusStack.ts';

/** everything a session keeps above its composer: live rows, the queue, and whether the reader folded the stack away */
export type SessionStack = { status: StatusState; queue: QueueState; hidden: boolean };

export const emptyStack = (): SessionStack => ({ status: emptyStatus(), queue: emptyQueue(), hidden: false });

/** the part that outlives the process: the queued prompts and the folded choice (a park never does) */
export type PersistedStack = { queue: QueueEntry[]; hidden: boolean };

/** where the host keeps a stack between launches; `load` runs when a session is opened */
export type StackStore = {
  load(key: string): Promise<PersistedStack | null>;
  save(key: string, stack: PersistedStack): void;
};

export const persistedStack = (stack: SessionStack): PersistedStack => ({ queue: stack.queue.entries, hidden: stack.hidden });

/** adopt a saved stack, never over prompts queued since the session opened */
export function restoreStack(stack: SessionStack, saved: PersistedStack): SessionStack {
  return { ...stack, hidden: saved.hidden, queue: stack.queue.entries.length ? stack.queue : queueFrom(saved.queue) };
}

export type StatusHost = {
  get(key: string): StatusState | undefined;
  set(key: string, update: (state: StatusState) => StatusState): void;
  /** the gateway's id for the session, once bound */
  runtimeId(key: string): string | null;
  profile(key: string): string;
  ready(): boolean;
  request<M extends keyof RpcMethods>(method: M, params: RpcMethods[M]['params']): Promise<RpcMethods[M]['result']>;
  notify(text: string): void;
  after(ms: number, run: () => void): () => void;
  now(): number;
};

const isMethodNotFound = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === -32601 || /method[ -]not[ -]found/i.test(errorText(error));
};

export class StatusSync {
  private readonly host: StatusHost;
  private readonly timers = new Map<string, () => void>();

  constructor(host: StatusHost) {
    this.host = host;
  }

  private apply(key: string, update: (state: StatusState) => StatusState) {
    this.host.set(key, update);
    this.arm(key);
  }

  /** wake when the next lingering row is due */
  private arm(key: string) {
    this.timers.get(key)?.();
    this.timers.delete(key);
    const state = this.host.get(key);
    const due = state ? statusNextExpiry(state) : null;
    if (due === null) return;
    this.timers.set(
      key,
      this.host.after(Math.max(0, due - this.host.now()), () => {
        this.timers.delete(key);
        this.apply(key, (s) => tickStatus(s, this.host.now()));
      }),
    );
  }

  /** a live event for the session; the cheap check keeps every text delta out of the reducer */
  observe(key: string, event: StatusEvent) {
    if (!isStatusEvent(event.type)) return;
    this.apply(key, (state) => reduceStatus(state, event, this.host.now()));
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    // terminal and process calls are the only things that spawn or reap background work, and the gateway announces completions
    if ((event.type === 'tool.complete' && (payload.name === 'terminal' || payload.name === 'process')) || (event.type === 'status.update' && payload.kind === 'process')) {
      void this.refreshProcesses(key);
    }
  }

  /** a resume's snapshot, then the reads that only the gateway can answer */
  hydrate(key: string, resumed: { todo_state?: unknown; running?: boolean | null }) {
    this.apply(key, (state) => hydrateStatus(state, resumed, this.host.now()));
    void this.refresh(key);
  }

  refresh(key: string) {
    return Promise.all([this.refreshProcesses(key), this.refreshSubagents(key), this.refreshControl(key)]);
  }

  private params(key: string) {
    const runtimeId = this.host.runtimeId(key);
    return runtimeId && this.host.ready() ? { session_id: runtimeId, profile: this.host.profile(key) } : null;
  }

  async refreshProcesses(key: string) {
    const params = this.params(key);
    if (!params) return;
    try {
      const result = await this.host.request('process.list', params);
      this.apply(key, (state) => applyProcessList(state, result?.processes ?? [], this.host.now()));
    } catch {
      // a transient loss: the next event or poll retries
    }
  }

  async refreshSubagents(key: string) {
    const params = this.params(key);
    if (!params) return;
    try {
      const result = await this.host.request('subagent.list', params);
      if (!Array.isArray(result?.subagents)) return;
      this.apply(key, (state) =>
        applySubagentSnapshot(state, result.subagents as unknown as Array<Record<string, unknown>>, (result.delegations ?? []) as unknown as Array<Record<string, unknown>>, this.host.now()),
      );
    } catch {
      // older gateways keep their event-fed roster
    }
  }

  /** structured goal controls where the gateway has them, the goal command's own text where it does not */
  async refreshControl(key: string) {
    const params = this.params(key);
    if (!params || this.host.get(key)?.control.capability === 'unsupported') return;
    try {
      const result = await this.host.request('session.control.read', params);
      this.apply(key, (state) => applyControlSnapshot(state, result?.control));
    } catch (error) {
      if (!isMethodNotFound(error)) return;
      this.apply(key, markControlUnsupported);
      try {
        const result = await this.host.request('slash.exec', { ...params, command: 'goal status' });
        this.apply(key, (state) => applyGoalText(state, result?.output ?? '', this.host.now(), { hydrate: true }));
      } catch {
        // best effort: a gateway without either simply shows no goal
      }
    }
  }

  dismiss(key: string, id: string) {
    this.apply(key, (state) => dismissBackground(state, id));
  }

  /** kill the process for real, then drop the row; on a failed kill the row stays so the reader can retry */
  async stopProcess(key: string, id: string) {
    const params = this.params(key);
    if (!params) {
      this.host.notify('Could not stop the process. The gateway is not connected.');
      return;
    }
    try {
      await this.host.request('process.kill', { ...params, process_id: id });
      this.dismiss(key, id);
    } catch (error) {
      this.host.notify(`Could not stop the process. ${errorText(error)}`);
    }
  }

  /** a rewind discarded the turns that spawned the background rows: kill the live processes and drop every row */
  resetBackground(key: string) {
    const params = this.params(key);
    if (params) {
      for (const item of this.host.get(key)?.background ?? []) {
        if (item.state === 'running') void this.host.request('process.kill', { ...params, process_id: item.id }).catch(() => undefined);
      }
    }
    this.apply(key, resetBackground);
  }

  async steerSubagent(key: string, subagentId: string, text: string): Promise<string> {
    const params = this.params(key);
    if (!params) return STATUS_COPY.requestRejected;
    try {
      const result = await this.host.request('subagent.steer', { ...params, subagent_id: subagentId, text: text.trim() });
      return result.status === 'queued' ? STATUS_COPY.steerQueued : STATUS_COPY.requestRejected;
    } catch {
      return STATUS_COPY.requestRejected;
    }
  }

  async interruptSubagent(key: string, subagentId: string): Promise<string> {
    const params = this.params(key);
    if (!params) return STATUS_COPY.requestRejected;
    try {
      const result = await this.host.request('subagent.interrupt', { ...params, subagent_id: subagentId });
      return result.found ? STATUS_COPY.stopRequested : STATUS_COPY.requestRejected;
    } catch {
      return STATUS_COPY.requestRejected;
    }
  }

  dispose() {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }
}
