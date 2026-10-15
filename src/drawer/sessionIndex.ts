/**
 * The sessions list's pure logic: titles, the pinned/recents split, the messaging platform groups
 * and the search merge (apps/desktop/src/lib/chat-runtime.ts `sessionTitle`, lib/session-search.ts,
 * app/chat/sidebar/session-index.ts, index.tsx `mergeSearchResults` and `messagingGroups`).
 */

import type { SessionInfo } from '../chat/controller.ts';
import { sessionTime } from './sessionDates.ts';
import { normalizeSessionSource, sessionSourceLabel, sessionSourceSearchTerms } from './sessionSources.ts';

export const UNTITLED_SESSION = 'Untitled session';

/** what a row is called: its title, else the first thing said in it, else a placeholder */
export const sessionTitle = (session: Pick<SessionInfo, 'title' | 'preview'>): string => session.title?.trim() || session.preview?.trim() || UNTITLED_SESSION;

/** the row key: twins with one stored id on two profiles are two rows */
export const sessionRowKey = (session: Pick<SessionInfo, 'id' | 'profile'>) => `${session.profile ?? ''}::${session.id}`;

/** desktop `sessionMatchesSearch`: every field a row can be found by, plus its platform's names */
export function sessionMatchesSearch(session: SessionInfo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    session.id,
    session._lineage_root_id ?? '',
    sessionTitle(session),
    session.preview ?? '',
    session.cwd ?? '',
    session.git_branch ?? '',
    ...sessionSourceSearchTerms(session.source),
  ].some((value) => value.toLowerCase().includes(needle));
}

// ─── pinned and recents ──────────────────────────────────────────────────────

/**
 * Every id a session can be reached by: its live id and its lineage root, so a pin stored before an
 * auto-compression still resolves to the continuation tip (desktop `buildSessionByAnyId`).
 */
export function buildSessionByAnyId(...lists: ReadonlyArray<readonly SessionInfo[]>): Map<string, SessionInfo> {
  const map = new Map<string, SessionInfo>();
  for (const session of lists.flat()) {
    map.set(session.id, session);
    if (session._lineage_root_id && !map.has(session._lineage_root_id)) map.set(session._lineage_root_id, session);
  }
  return map;
}

const byRecency = (a: SessionInfo, b: SessionInfo) => sessionTime(b) - sessionTime(a);

/**
 * The Pinned section's rows and the recents they leave behind. A pinned session is filtered out of its
 * own section, so the server's `pinned` flag, not the page, decides: a pinned row is always reachable
 * here, whichever list it arrived in.
 */
export function splitPinned(recents: readonly SessionInfo[], messaging: readonly SessionInfo[]) {
  const pinned = [...recents, ...messaging].filter((session) => session.pinned === true).sort(byRecency);
  return {
    pinned,
    recents: recents.filter((session) => session.pinned !== true),
    messaging: messaging.filter((session) => session.pinned !== true),
    pinnedBySource: countBySource(messaging.filter((session) => session.pinned === true)),
  };
}

function countBySource(sessions: readonly SessionInfo[]) {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const id = normalizeSessionSource(session.source);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ─── messaging platform groups ───────────────────────────────────────────────

export type MessagingGroup = { sourceId: string; label: string; sessions: SessionInfo[]; hasMore: boolean };

/** how many of a platform's rows show before "load more" (desktop `NON_SESSION_INITIAL_ROWS`) */
export const MESSAGING_INITIAL_ROWS = 3;
/** how many more each tap reveals (desktop `NON_SESSION_LOAD_STEP`) */
export const MESSAGING_LOAD_STEP = 10;

/**
 * One section per platform, the most recently active first, rows by recency. When the messaging window
 * came back full more may remain on disk, so every group offers more until it is widened.
 */
export function messagingGroups(messaging: readonly SessionInfo[], truncated: boolean): MessagingGroup[] {
  const bySource = new Map<string, SessionInfo[]>();
  for (const session of messaging) {
    const sourceId = normalizeSessionSource(session.source);
    if (!sourceId) continue;
    const list = bySource.get(sourceId) ?? [];
    list.push(session);
    bySource.set(sourceId, list);
  }
  return [...bySource.entries()]
    .map(([sourceId, list]) => ({
      sourceId,
      label: sessionSourceLabel(sourceId) ?? sourceId,
      sessions: [...list].sort(byRecency),
      hasMore: truncated,
    }))
    .sort((a, b) => sessionTime(b.sessions[0]!) - sessionTime(a.sessions[0]!));
}

// ─── search ──────────────────────────────────────────────────────────────────

/** one `/api/sessions/search` hit (desktop `SessionSearchResult`) */
export type SessionSearchResult = {
  session_id: string;
  title?: string | null;
  snippet?: string | null;
  source?: string | null;
  model?: string | null;
  last_active?: number | null;
  session_started?: number | null;
  lineage_root?: string | null;
};

/** the backend wraps matched terms in literal `>>>` / `<<<` markers; the list shows plain text */
export const stripFtsMarkers = (snippet: string) => snippet.replaceAll('>>>', '').replaceAll('<<<', '');

/** a hit outside the loaded page, as a row: resume works by id, the snippet stands in for the preview */
export function searchResultToSession(result: SessionSearchResult, nowSeconds = Date.now() / 1000): SessionInfo {
  const started = result.session_started ?? nowSeconds;
  return {
    id: result.session_id,
    _lineage_root_id: result.lineage_root ?? null,
    title: result.title?.trim() || null,
    preview: stripFtsMarkers(result.snippet ?? '').trim() || null,
    started_at: started,
    last_active: result.last_active ?? started,
    source: result.source ?? null,
    model: result.model ?? null,
    message_count: 0,
  };
}

/**
 * The Results section's rows. While the request is in flight the client's own recency-ordered matches
 * are all there is, so typing answers instantly; once the ranked response lands it decides the order
 * (the backend runs exact id matches before content hits), and client-only matches the index missed
 * (a cwd, a branch) follow in recency order.
 */
export function mergeSearchResults(
  sorted: readonly SessionInfo[],
  query: string,
  serverMatches: readonly SessionSearchResult[],
  byAnyId: ReadonlyMap<string, SessionInfo>,
  pending: boolean,
): SessionInfo[] {
  if (!query) return [];
  const out = new Map<string, SessionInfo>();
  if (pending) {
    for (const session of sorted) if (sessionMatchesSearch(session, query)) out.set(session.id, session);
    return [...out.values()];
  }
  for (const match of serverMatches) {
    if (out.has(match.session_id)) continue;
    out.set(match.session_id, byAnyId.get(match.session_id) ?? searchResultToSession(match));
  }
  for (const session of sorted) if (!out.has(session.id) && sessionMatchesSearch(session, query)) out.set(session.id, session);
  return [...out.values()];
}
