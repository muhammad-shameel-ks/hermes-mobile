/**
 * Paging a session's history over REST. Port of the desktop's tail bookkeeping
 * (store/transcript-tail.ts) and older-page backfill (app/chat/transcript-backfill.ts):
 * the newest 120 rows load first, offsets count back from the newest row, and
 * "Show earlier" fetches the page immediately older than what is held.
 *
 * Rows persisted after a page was read shift the offset origin, so pages can
 * overlap what is held; messages carry their first stored row in their id
 * (`row-<id>`) and every merge here dedupes on it.
 */

import type { Message, Part, SessionMessage, ToolPart } from './transcript.ts';

export const HISTORY_LIMIT = 120;

export type HistoryState = {
  /** offset, counted back from the newest stored row, where the next older page starts */
  nextOffset: number;
  /** the last page was full, so older rows likely exist */
  more: boolean;
  loadingEarlier: boolean;
};

export const NO_HISTORY: HistoryState = { nextOffset: 0, more: false, loadingEarlier: false };

export type MessagesPage = {
  messages?: SessionMessage[];
  pagination?: { limit?: number; offset?: number; order?: string; returned?: number };
};

/**
 * Paging state after `page`. A page without pagination metadata, or whose
 * server did not echo `order: 'latest'`, is a backend that ignored the paging
 * query: it holds the whole transcript from the oldest end, so nothing pages.
 * An empty read never disarms a tail already known to be truncated.
 */
export function historyFromPage(page: MessagesPage | undefined, previous: HistoryState = NO_HISTORY): HistoryState {
  const count = page?.messages?.length ?? 0;
  const pagination = page?.pagination;
  if (!pagination || !(typeof pagination.limit === 'number' && pagination.limit > 0) || pagination.order !== 'latest') {
    return { nextOffset: count, more: false, loadingEarlier: false };
  }
  if (count === 0 && previous.more) return { ...previous, loadingEarlier: false };
  return { nextOffset: (pagination.offset ?? 0) + count, more: count >= pagination.limit, loadingEarlier: false };
}

/**
 * Compaction can stamp the session's opening user row `display_kind: hidden`
 * while the durable store still holds the greeting; when an older page carries
 * that row, keep it on screen (desktop #96875). Only the first user row with
 * content is unhidden.
 */
export function unhideOpeningUserRows(rows: SessionMessage[]): SessionMessage[] {
  const index = rows.findIndex((row) => row.role === 'user');
  if (index < 0) return rows;
  const opening = rows[index];
  if (opening.display_kind !== 'hidden') return rows;
  const content = opening.display_content ?? opening.content;
  if (content === undefined || content === null || content === '') return rows;
  const { display_kind: _hidden, ...rest } = opening;
  const unhidden = { ...rest, display_content: typeof content === 'string' ? content : String(content) };
  return rows.map((row, i) => (i === index ? unhidden : row));
}

const ROW_ID = /^row-(\d+)$/;

/** the stored row a history message begins at, or null for a live message */
export function rowOf(message: Message): number | null {
  const match = ROW_ID.exec(message.id);
  return match ? Number(match[1]) : null;
}

function joinParts(earlier: Part[], later: Part[]): Part[] {
  const parts = [...earlier];
  for (const part of later) {
    if (part.kind === 'tool') {
      const at = parts.findIndex((p) => p.kind === 'tool' && p.id === part.id);
      if (at < 0) {
        parts.push(part);
        continue;
      }
      const have = parts[at] as ToolPart;
      // a call whose result landed on the next page: the orphan result completes it
      if (have.result === undefined && part.result !== undefined) parts[at] = { ...have, status: 'done', result: part.result };
      continue;
    }
    if (!parts.some((p) => p.kind === part.kind && p.text === part.text)) parts.push(part);
  }
  return parts;
}

/** one turn read in two pieces, because a page boundary fell inside it */
export function joinTurn(earlier: Message, later: Message): Message {
  return { ...earlier, parts: joinParts(earlier.parts, later.parts), error: later.error ?? earlier.error };
}

const sameTurn = (a: Message | undefined, b: Message | undefined) =>
  a !== undefined && b !== undefined && a.role === 'assistant' && b.role === 'assistant' && rowOf(a) !== null && rowOf(b) !== null;

/**
 * Place an older page in front of what is held. Messages the held transcript
 * already has are dropped; a turn the page boundary split is joined back up.
 * Returns `existing` itself when nothing changed.
 */
export function prependOlder(existing: Message[], older: Message[]): Message[] {
  if (existing.length === 0 || older.length === 0) return existing;
  const heldIds = new Set(existing.map((m) => m.id));
  const heldFrom = existing.map(rowOf).find((row): row is number => row !== null);
  const fresh = older.filter((m) => {
    if (heldIds.has(m.id)) return false;
    const row = rowOf(m);
    return heldFrom === undefined || row === null || row < heldFrom;
  });
  if (fresh.length === 0) return existing;
  const last = fresh[fresh.length - 1];
  if (sameTurn(last, existing[0])) return [...fresh.slice(0, -1), joinTurn(last, existing[0]), ...existing.slice(1)];
  return [...fresh, ...existing];
}

/**
 * Re-anchor a refreshed newest page onto a transcript that has paged earlier.
 * Re-reading only the newest page would otherwise drop every older page the
 * reader already pulled in. The refreshed page replaces everything it covers;
 * older rows held in front of it stay. A page sharing no message with what is
 * held is a compaction rewrite or a different transcript and replaces it all.
 */
export function graftTail(previous: Message[], refreshed: Message[]): Message[] {
  if (previous.length === 0 || refreshed.length === 0) return refreshed;
  const firstRow = rowOf(refreshed[0]);
  if (firstRow === null) return refreshed;
  const heldIds = new Set(previous.map((m) => m.id));
  if (!refreshed.some((m) => heldIds.has(m.id))) return refreshed;
  let end = 0;
  while (end < previous.length) {
    const row = rowOf(previous[end]);
    if (row === null || row >= firstRow) break;
    end += 1;
  }
  if (end === 0) return refreshed;
  const prefix = previous.slice(0, end);
  const last = prefix[end - 1];
  if (sameTurn(last, refreshed[0])) return [...prefix.slice(0, -1), joinTurn(last, refreshed[0]), ...refreshed.slice(1)];
  return [...prefix, ...refreshed];
}
