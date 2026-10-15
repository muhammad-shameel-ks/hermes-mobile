/**
 * Debounced full-text search across every session of the active profile, not just the loaded window,
 * so an old session stays findable (apps/desktop/src/app/chat/sidebar/use-server-session-search.ts `useServerSessionSearch`).
 */

import { useEffect, useRef, useState } from 'react';

import type { SessionSearchResult } from './sessionIndex.ts';

/** desktop `SEARCH_DEBOUNCE_MS` */
export const SEARCH_DEBOUNCE_MS = 200;

export function useSessionSearch(query: string, search: (query: string) => Promise<SessionSearchResult[]>) {
  const [matches, setMatches] = useState<SessionSearchResult[]>([]);
  const [pending, setPending] = useState(false);
  // a caller that rebuilds `search` every render must not restart the debounce and refetch each time
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!query) {
      setMatches((prev) => (prev.length === 0 ? prev : []));
      setPending(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    const timer = setTimeout(() => {
      searchRef.current(query)
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
  }, [query]);

  return { matches, pending };
}
