/**
 * Where the sessions list comes from: the batched sidebar route the desktop reads (recents and the
 * messaging slice in one request, each window widened by raising its limit), with the plain
 * `/api/sessions` read for a gateway that predates it, and the full-text search behind the drawer's
 * field (apps/desktop/src/api/sessions.ts `listSidebarSessions`, `searchSessions`;
 * app/session/hooks/use-session-list-actions.ts).
 */

import type { SessionInfo } from '../chat/controller.ts';
import type { GatewayApi } from '../gateway/api.ts';
import { isUnroutedRestPath } from './session-actions.ts';
import type { SessionSearchResult } from './sessionIndex.ts';
import { MESSAGING_EXCLUDED_SOURCES, RECENTS_EXCLUDED_SOURCES } from './sessionSources.ts';

/** desktop `SIDEBAR_SESSIONS_PAGE_SIZE`: how many rows each "load more" adds */
export const SESSIONS_PAGE_SIZE = 50;
/** the sidebar route clamps every window here */
export const SESSIONS_MAX_LIMIT = 500;
/** desktop `MESSAGING_SECTION_LIMIT`: the messaging window, widened by the same step */
export const MESSAGING_WINDOW = 100;
/** `/api/sessions` caps its page here, so a gateway on the plain route cannot widen past it */
const PLAIN_ROUTE_MAX = 100;

/** sources that never list as conversations (desktop `use-session-list-actions.ts`) */
const UNLISTED_SOURCES = new Set(['acp', 'cron', 'kanban', 'oneshot', 'subagent', 'tool']);
export const listable = (session: SessionInfo) => !UNLISTED_SOURCES.has((session.source ?? '').toLowerCase());

export type SessionsPage = {
  recents: SessionInfo[];
  messaging: SessionInfo[];
  /** the recents window came back full: more rows remain on disk */
  recentsTruncated: boolean;
  messagingTruncated: boolean;
  /** `state.db` is damaged: the list below it may be thinner than the history (desktop `$corruptSessionStores`) */
  corrupt: boolean;
};

type Slice = { sessions?: SessionInfo[]; profiles_truncated?: Record<string, boolean>; failed?: boolean; retry?: boolean; errors?: unknown[] };
type SidebarResponse = { recents?: Slice; messaging?: Slice; storage?: Record<string, string> };
type PlainResponse = { sessions?: SessionInfo[]; storage?: Record<string, string> };

export type SessionListApi = Pick<GatewayApi, 'get'>;

/** the next window after a "load more" (desktop `bumpSessionsLimit`), clamped to what the route serves */
export const widened = (limit: number, step = SESSIONS_PAGE_SIZE, max = SESSIONS_MAX_LIMIT) => Math.min(max, limit + step);

export function createSessionLister(api: SessionListApi) {
  // a missing batched route is a capability fact: remember it rather than probing a dead route per refresh
  let batchedMissing = false;

  const plain = async (profile: string, limit: number, exclude: string[]) => {
    const result = await api.get<PlainResponse>('/api/sessions', {
      limit: Math.min(limit, PLAIN_ROUTE_MAX),
      offset: 0,
      min_messages: 1,
      archived: 'exclude',
      order: 'recent',
      exclude_sources: exclude.join(','),
      profile,
    });
    return { sessions: (result?.sessions ?? []).filter(listable), storage: result?.storage ?? {} };
  };

  const fromPlainRoute = async (profile: string, limit: number, messagingLimit: number): Promise<SessionsPage> => {
    const [recents, messaging] = await Promise.all([plain(profile, limit, RECENTS_EXCLUDED_SOURCES), plain(profile, messagingLimit, MESSAGING_EXCLUDED_SOURCES)]);
    return {
      recents: recents.sessions,
      messaging: messaging.sessions,
      recentsTruncated: recents.sessions.length >= Math.min(limit, PLAIN_ROUTE_MAX) && limit < PLAIN_ROUTE_MAX,
      messagingTruncated: messaging.sessions.length >= Math.min(messagingLimit, PLAIN_ROUTE_MAX) && messagingLimit < PLAIN_ROUTE_MAX,
      corrupt: Object.keys(recents.storage).length > 0,
    };
  };

  return {
    /** the recents and messaging windows for one profile */
    async page(profile: string, limit: number, messagingLimit = MESSAGING_WINDOW): Promise<SessionsPage> {
      if (batchedMissing) return fromPlainRoute(profile, limit, messagingLimit);
      let result: SidebarResponse | undefined;
      try {
        result = await api.get<SidebarResponse>('/api/profiles/sessions/sidebar', {
          recents_profile: profile,
          recents_limit: limit,
          recents_exclude: RECENTS_EXCLUDED_SOURCES.join(','),
          cron_limit: 1,
          messaging_limit: messagingLimit,
          messaging_exclude: MESSAGING_EXCLUDED_SOURCES.join(','),
        });
      } catch (error) {
        if (!isUnroutedRestPath(error)) throw error;
        batchedMissing = true;
        return fromPlainRoute(profile, limit, messagingLimit);
      }
      const recents = result?.recents ?? {};
      const messaging = result?.messaging ?? {};
      const rows = (recents.sessions ?? []).filter(listable);
      // a failed scan is not an empty list: surface it so the list offers a retry instead of "No sessions yet"
      if (rows.length === 0 && (recents.failed || recents.retry)) throw new Error('Could not load sessions');
      return {
        recents: rows,
        messaging: (messaging.sessions ?? []).filter(listable),
        recentsTruncated: Object.values(recents.profiles_truncated ?? {}).some(Boolean) && limit < SESSIONS_MAX_LIMIT,
        messagingTruncated: (messaging.sessions?.length ?? 0) >= Math.min(messagingLimit, SESSIONS_MAX_LIMIT) && messagingLimit < SESSIONS_MAX_LIMIT,
        corrupt: Object.keys(result?.storage ?? {}).length > 0,
      };
    },

    /** full-text search across every session, not just the loaded window */
    async search(query: string, profile: string): Promise<SessionSearchResult[]> {
      const result = await api.get<{ results?: SessionSearchResult[] }>('/api/sessions/search', { q: query, profile });
      return result?.results ?? [];
    },
  };
}

export type SessionLister = ReturnType<typeof createSessionLister>;
