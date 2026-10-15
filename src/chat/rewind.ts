/**
 * Rewinding a conversation to one of its user turns: retry (regenerate), edit
 * and restore are the same `prompt.submit` with a truncation address, as on the
 * desktop (app/session/hooks/use-prompt-actions/rewind.ts). Pure planning and
 * transcript maths live here; the controller owns the socket.
 *
 * A turn is addressed by its durable row id. A message that has none yet - a
 * just-sent prompt - is found by content in `session.history`, exact or nothing;
 * when that fails too the submit degrades to a plain resubmit, never a guessed cut.
 */

import type { Message, Transcript } from './transcript.ts';
import { idleWait } from './turnActivity.ts';

/** desktop `RECENT_INTERRUPT_COOLDOWN_MS`: how long after Stop a rewind still interrupts first */
export const RECENT_INTERRUPT_COOLDOWN_MS = 3_000;
/** desktop `SESSION_BUSY_RETRY_*`: a raced "session busy" is retried until the turn settles */
export const SESSION_BUSY_RETRY_TIMEOUT_MS = 6_000;
export const SESSION_BUSY_RETRY_INTERVAL_MS = 150;
/** `prompt.submit` refused a cut that would archive later user turns */
export const DEEP_TRUNCATE_REFUSED_CODE = 4033;

export const RESTORE_COPY = {
  title: 'Restore to this checkpoint?',
  body: 'Everything after this prompt is removed from the conversation, and the prompt runs again from here.',
  confirm: 'Restore & rerun',
} as const;

const textParts = (message: Message) => message.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : []));

/** the prompt as the user wrote it, which is what a rewind resubmits */
export const promptText = (message: Message) => textParts(message).join('\n').trim();

export type RewindPlan = {
  /** index of the user turn the conversation rewinds to */
  index: number;
  /** that turn's text, and the text to run (the edit, or the same prompt) */
  sourceText: string;
  text: string;
  rowId: number | undefined;
  /** user turns after the target: what the cut archives */
  laterUserTurns: number;
  /** the target is the newest user turn, which disambiguates a repeated prompt */
  targetIsLast: boolean;
};

/** the user turn a rewind from `messageId` re-runs: the message itself, or the prompt a reply answers */
export function userTurnIndex(messages: readonly Message[], messageId: string): number {
  const at = messages.findIndex((message) => message.id === messageId);
  if (at < 0) return -1;
  for (let i = at; i >= 0; i -= 1) if (messages[i].role === 'user') return i;
  return -1;
}

/** null when the turn is gone or has nothing to run */
export function planRewind(messages: readonly Message[], messageId: string, text?: string): RewindPlan | null {
  const index = userTurnIndex(messages, messageId);
  if (index < 0) return null;
  const sourceText = promptText(messages[index]);
  const run = (text ?? sourceText).trim();
  if (!run) return null;
  const later = messages.slice(index + 1).filter((message) => message.role === 'user').length;
  return { index, sourceText, text: run, rowId: messages[index].rowId, laterUserTurns: later, targetIsLast: later === 0 };
}

/** desktop `truncateSubmitParams` for a row-addressed cut */
export function truncateParams(rowId: number, confirmDeep: boolean): Record<string, unknown> {
  return {
    confirm_truncate: true,
    truncate_before_row_id: rowId,
    confirm_empty_truncate: true,
    ...(confirmDeep ? { confirm_deep_truncate: true } : {}),
  };
}

type HistoryRow = { role?: string; display_kind?: string | null; row_id?: unknown; text?: string | null };

/**
 * desktop `resolveDurableRowId`: a unique content match wins; among repeats the last
 * persisted user turn is the answer only when the target is the newest one.
 */
export function matchDurableRowId(rows: readonly HistoryRow[], sourceText: string, targetIsLast: boolean): number | undefined {
  const wanted = sourceText.trim();
  if (!wanted) return undefined;
  const users = rows.filter((row) => row.role === 'user' && !row.display_kind && typeof row.row_id === 'number' && Number.isInteger(row.row_id));
  const matches = users.filter((row) => (row.text ?? '').trim() === wanted);
  if (matches.length === 1) return matches[0].row_id as number;
  if (matches.length > 1 && targetIsLast) {
    const last = matches[matches.length - 1];
    return users[users.length - 1] === last ? (last.row_id as number) : undefined;
  }
  return undefined;
}

export type SurvivorRowIds = ReadonlyArray<number | null> | Map<number, number | null>;

/** the gateway's post-rewrite row ids: an old-to-new map, or visible-user ids in ordinal order on older servers */
export function survivorRowIdsFrom(result: { survivor_row_id_map?: unknown; survivor_user_row_ids?: unknown } | null | undefined): SurvivorRowIds | undefined {
  const map = result?.survivor_row_id_map;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const parsed = new Map<number, number | null>();
    for (const [oldId, newId] of Object.entries(map)) {
      const previous = Number(oldId);
      if (!Number.isInteger(previous)) continue;
      if (newId === null) parsed.set(previous, null);
      else if (typeof newId === 'number' && Number.isInteger(newId)) parsed.set(previous, newId);
    }
    return parsed;
  }
  const list = result?.survivor_user_row_ids;
  if (!Array.isArray(list)) return undefined;
  return list.map((id) => (typeof id === 'number' && Number.isInteger(id) ? id : null));
}

/** every durable row id the transcript holds: the ids a truncating submit is asked to remap */
export function durableRowIds(messages: readonly Message[]): number[] {
  return [...new Set(messages.flatMap((message) => (typeof message.rowId === 'number' ? [message.rowId] : [])))];
}

/**
 * desktop `rebindSurvivorRowIds`. A rewrite re-inserts the kept prefix as new rows, so
 * every cached id is stale; a turn with no survivor slot (the resubmitted one) loses its id.
 */
export function rebindRowIds(messages: Message[], survivors: SurvivorRowIds): Message[] {
  const withRow = (message: Message, rowId: number | undefined): Message => {
    if (message.rowId === rowId) return message;
    const { rowId: _dropped, ...rest } = message;
    return rowId === undefined ? rest : { ...rest, rowId };
  };
  if (survivors instanceof Map) {
    return messages.map((message) => {
      if (message.rowId === undefined || !survivors.has(message.rowId)) return message;
      return withRow(message, survivors.get(message.rowId) ?? undefined);
    });
  }
  let ordinal = 0;
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const next = ordinal < survivors.length ? survivors[ordinal] : null;
    ordinal += 1;
    return withRow(message, typeof next === 'number' ? next : undefined);
  });
}

/** desktop `applyRewindOptimistic`: drop everything after the turn, swap in the edit, and run */
export function rewindOptimistic(transcript: Transcript, plan: RewindPlan): Transcript {
  const source = transcript.messages[plan.index];
  const edited: Message =
    plan.text === plan.sourceText ? source : { ...source, parts: [{ kind: 'text', text: plan.text }], reactions: undefined };
  return { ...transcript, messages: [...transcript.messages.slice(0, plan.index), edited], running: true, liveId: null, breakText: false, wait: idleWait() };
}

/** the row id `prompt.submit` just minted for the optimistic user message */
export function stampUserRowId(transcript: Transcript, rowId: number): Transcript {
  for (let i = transcript.messages.length - 1; i >= 0; i -= 1) {
    const message = transcript.messages[i];
    if (message.role !== 'user') continue;
    if (message.rowId !== undefined) return transcript;
    const messages = transcript.messages.slice();
    messages[i] = { ...message, rowId };
    return { ...transcript, messages };
  }
  return transcript;
}

/** desktop `shouldInterruptBeforeRewind`: busy, or Stop within the last few seconds */
export class RecentInterrupts {
  private readonly until = new Map<string, number>();

  mark(sessionId: string, now = Date.now()) {
    if (sessionId) this.until.set(sessionId, now + RECENT_INTERRUPT_COOLDOWN_MS);
  }

  recent(sessionId: string, now = Date.now()): boolean {
    const until = this.until.get(sessionId);
    if (until === undefined) return false;
    if (now >= until) {
      this.until.delete(sessionId);
      return false;
    }
    return true;
  }

  shouldInterruptFirst(opts: { busy: boolean; sessionId: string; now?: number }): boolean {
    return opts.busy || this.recent(opts.sessionId, opts.now);
  }
}

export const isSessionBusyError = (error: unknown) => /session[ _]busy/i.test(error instanceof Error ? error.message : String(error));

export const isDeepTruncateRefusal = (error: unknown) => (error as { code?: unknown } | null)?.code === DEEP_TRUNCATE_REFUSED_CODE;

/** the target row was archived or rewritten since the client learned its id */
export const isStaleTargetError = (error: unknown) =>
  /no longer in session history|not in session history/i.test(error instanceof Error ? error.message : String(error));

/** desktop `withSessionBusyRetry`: a call that races the end of a turn is repeated until the turn settles */
export async function retryWhileBusy<T>(
  call: () => Promise<T>,
  { timeoutMs = SESSION_BUSY_RETRY_TIMEOUT_MS, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (!isSessionBusyError(error) || Date.now() >= deadline) throw error;
      await sleep(SESSION_BUSY_RETRY_INTERVAL_MS);
    }
  }
}
