/**
 * The queue: prompts the client holds back while a turn runs and sends one at a
 * time when it ends. Pure functions over plain, JSON-serialisable data - a port
 * of apps/desktop/src/store/composer-queue.ts minus its cross-window claim,
 * attachments and terminal chips, none of which the phone has.
 *
 * Stop parks the queue: a parked queue is skipped by the drain until the reader
 * resumes it, sends or steers an entry, edits one, or queues something new.
 * Emptying it lifts the park, so a stale gate never holds back a later prompt.
 */

import { SLASH_COMMAND_RE } from '../../vendor/hermes-shared/src/slash.ts';

export type QueueEntry = {
  id: string;
  text: string;
  /** epoch ms */
  queuedAt: number;
  /** consecutive auto-drain attempts that were rejected */
  drainFailures?: number;
};

export type QueueState = {
  entries: QueueEntry[];
  /** Stop closed the queue to the drain; never persisted, so a fresh process starts unparked */
  parked: boolean;
  /** the entry being rewritten in its row: the drain passes it over */
  editing: string | null;
};

/** auto-drain attempts for one entry before the drain gives up and the entry waits for a manual send */
export const MAX_AUTO_DRAIN_ATTEMPTS = 4;

export const emptyQueue = (): QueueState => ({ entries: [], parked: false, editing: null });

export const queueFrom = (entries: readonly QueueEntry[]): QueueState => ({ ...emptyQueue(), entries: [...entries] });

export function enqueue(state: QueueState, id: string, text: string, now: number): QueueState {
  // Queueing is fresh intent to keep the conversation moving: it lifts a park and
  // the failure budget of the entries already waiting.
  const entries = state.entries.map((entry) => (entry.drainFailures ? { ...entry, drainFailures: undefined } : entry));
  return { ...state, entries: [...entries, { id, text, queuedAt: now }], parked: false };
}

export function remove(state: QueueState, id: string): QueueState {
  if (!state.entries.some((entry) => entry.id === id)) return state;
  const entries = state.entries.filter((entry) => entry.id !== id);
  return { entries, parked: entries.length === 0 ? false : state.parked, editing: state.editing === id ? null : state.editing };
}

/** Rewrite an entry's text; a blank rewrite is refused so the queue never holds an empty turn. */
export function edit(state: QueueState, id: string, text: string): QueueState {
  if (!text.trim()) return state;
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.id !== id || entry.text === text) return entry;
    changed = true;
    return { ...entry, text, drainFailures: undefined };
  });
  return changed ? { ...state, entries } : state;
}

/** Open an entry for rewriting; one at a time, as the desktop's composer takes one. */
export function beginEdit(state: QueueState, id: string): QueueState {
  return state.editing || !state.entries.some((entry) => entry.id === id) ? state : { ...state, editing: id };
}

export const endEdit = (state: QueueState): QueueState => (state.editing ? { ...state, editing: null } : state);

/** Move an entry to the head, so the next drain sends it. */
export function promote(state: QueueState, id: string): QueueState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index <= 0) return state;
  return { ...state, entries: [state.entries[index], ...state.entries.slice(0, index), ...state.entries.slice(index + 1)] };
}

/** Parking exists to hold back queued turns; with none queued it would only linger as a stale gate. */
export function park(state: QueueState): QueueState {
  return state.parked || state.entries.length === 0 ? state : { ...state, parked: true };
}

export const unpark = (state: QueueState): QueueState => (state.parked ? { ...state, parked: false } : state);

export function noteDrainFailure(state: QueueState, id: string): QueueState {
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? { ...entry, drainFailures: (entry.drainFailures ?? 0) + 1 } : entry)) };
}

export function clearDrainFailures(state: QueueState, id: string): QueueState {
  if (!state.entries.some((entry) => entry.id === id && entry.drainFailures)) return state;
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? { ...entry, drainFailures: undefined } : entry)) };
}

/**
 * Whether to send the head now. Edge-independent on purpose: the queue advances
 * whenever the session is idle and holds entries, not only on an observed
 * busy -> idle edge, because a redial swallows the edge and would strand the
 * entry. The one deliberate exception is a park.
 */
export const shouldAutoDrain = ({ busy, parked, length }: { busy: boolean; parked: boolean; length: number }): boolean => !busy && !parked && length > 0;

/** the head the drain would send: the first entry that has not used up its attempts, skipping one being edited */
export function drainHead(state: QueueState): QueueEntry | undefined {
  const head = state.entries.find((entry) => entry.id !== state.editing);
  return head && (head.drainFailures ?? 0) < MAX_AUTO_DRAIN_ATTEMPTS ? head : undefined;
}

/** retry delay after the nth consecutive rejected attempt (desktop `750 * fails`) */
export const drainRetryMs = (failures: number) => 750 * failures;

/** a redirect carries text only, and a slash command executes rather than steers */
export const isSteerable = (text: string) => text.trim() !== '' && !SLASH_COMMAND_RE.test(text.trim());

/** the busy composer's Send steers; anything a steer cannot carry runs as the next turn instead */
export const busySendAction = ({ text, runtimeBound, blockingPrompt = false }: { text: string; runtimeBound: boolean; blockingPrompt?: boolean }): 'steer' | 'queue' =>
  runtimeBound && !blockingPrompt && isSteerable(text) ? 'steer' : 'queue';

export const QUEUE_COPY = {
  queued: (count: number) => `${count} Queued`,
  queuedPaused: (count: number) => `${count} Queued — paused`,
  emptyTurn: 'Empty turn',
  edit: 'Edit',
  expand: 'Expand',
  collapse: 'Collapse',
  sendNext: 'Next',
  steer: 'Steer — redirect the live turn now',
  send: 'Send',
  delete: 'Delete',
  resume: 'Resume',
  resumeTip: 'Paused by Stop — resume sending the queued turns',
  stuckTitle: 'Queued message not sent',
  stuckBody: 'A queued turn kept failing to send. It is still in the queue — try sending it again.',
  queueMessage: 'Queue message',
  save: 'Save',
  cancel: 'Cancel',
} as const;

/** an entry's text on the panel */
export const entryPreview = (entry: Pick<QueueEntry, 'text'>) => entry.text.trim() || QUEUE_COPY.emptyTurn;

/** a preview long enough (or multiline enough) that two lines may hide part of it */
export const offersExpandedPreview = (preview: string) => preview.length > 140 || preview.includes('\n');

let counter = 0;
export const nextQueueId = () => `queued-${Date.now()}-${(counter += 1).toString(36)}`;
