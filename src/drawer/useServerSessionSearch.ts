/**
 * Debounced full-text search across every session of the active profile, not just the loaded window,
 * so an old session stays findable (apps/desktop/src/app/chat/sidebar/use-server-session-search.ts).
 */

import { useEffect, useState } from 'react';

import type { SessionSearchResult } from './sessionIndex.ts';

/** desktop `SEARCH_DEBOUNCE_MS` */
export const SEARCH_DEBOUNCE_MS = 200;

export function useServerSessionSearch(query: string, search: (query: string) => Promise<SessionSearchResult[]>) {
  const [matches, setMatches] = useState<SessionSearchResult[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!query) {
      setMatches([]);
      setPending(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    const timer = setTimeout(() => {
      search(query)
        .then((results) => {
          if (!cancelled) setMatches(results);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, search]);

  return { matches, pending };
}
