/**
 * The composer's text, kept per session in the draft store: it comes back when
 * the session reopens, is written 400 ms after the last keystroke and flushed
 * when the composer moves to another session or unmounts.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { DraftStore } from '../store/drafts.ts';

export function useComposerDraft(drafts: DraftStore, profile: string, session: string) {
  const text = useSyncExternalStore(drafts.subscribe, () => drafts.get(profile, session));
  const setText = useCallback((value: string) => drafts.set(profile, session, value), [drafts, profile, session]);
  const clear = useCallback(() => drafts.clear(profile, session), [drafts, profile, session]);
  useEffect(
    () => () => {
      drafts.release(profile, session);
      void drafts.flush();
    },
    [drafts, profile, session],
  );
  return { text, setText, clear };
}

export function useRestoredDraft(drafts: DraftStore) {
  return useSyncExternalStore(drafts.subscribe, drafts.getRestored);
}
