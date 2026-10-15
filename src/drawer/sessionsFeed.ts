/**
 * The sessions list's state and its widening: what the drawer shows, how a "load more" raises a
 * window and refetches, and the guards that keep a stale reply (another profile, an older request)
 * from landing. The controller owns one and publishes its state in the snapshot.
 */

import type { SessionInfo } from '../chat/controller.ts';
import { errorText } from '../gateway/http.ts';
import { createSessionLister, MESSAGING_WINDOW, SESSIONS_PAGE_SIZE, widened, type SessionListApi, type SessionLister } from './sessionList.ts';

export type SessionsState = {
  /** the local recents, newest first (pinned rows included: the gateway back-fills them past the window) */
  items: SessionInfo[];
  /** external-platform sessions, split into per-platform sections by the list */
  messaging: SessionInfo[];
  /** a first read is in flight with nothing to show yet */
  loading: boolean;
  /** a first read has landed, so an empty list is a fact rather than a wait */
  loaded: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  hasMoreMessaging: boolean;
  /** the session store is damaged: chats missing from the list were not deleted */
  corrupt: boolean;
};

export const emptySessions = (): SessionsState => ({
  items: [],
  messaging: [],
  loading: false,
  loaded: false,
  loadingMore: false,
  error: null,
  hasMore: false,
  hasMoreMessaging: false,
  corrupt: false,
});

export type SessionsStore = {
  profile: () => string;
  get: () => SessionsState;
  set: (next: SessionsState) => void;
};

export class SessionsFeed {
  private readonly lister: SessionLister;
  private limit = SESSIONS_PAGE_SIZE;
  private messagingLimit = MESSAGING_WINDOW;
  private request = 0;
  private readonly store: SessionsStore;

  constructor(api: SessionListApi, store: SessionsStore) {
    this.lister = createSessionLister(api);
    this.store = store;
  }

  /** the active profile changed: its list starts from the first window */
  reset() {
    this.limit = SESSIONS_PAGE_SIZE;
    this.messagingLimit = MESSAGING_WINDOW;
    this.request += 1;
    this.store.set({ ...emptySessions(), loading: true });
  }

  async refresh() {
    const profile = this.store.profile();
    const id = ++this.request;
    const current = this.store.get();
    // the skeletons are for an empty list: a refresh over rows does not flash them
    if (!current.loaded) this.store.set({ ...current, loading: true });
    try {
      const page = await this.lister.page(profile, this.limit, this.messagingLimit);
      if (id !== this.request || profile !== this.store.profile()) return;
      this.store.set({
        items: page.recents,
        messaging: page.messaging,
        loading: false,
        loaded: true,
        loadingMore: false,
        error: null,
        hasMore: page.recentsTruncated,
        hasMoreMessaging: page.messagingTruncated,
        corrupt: page.corrupt,
      });
    } catch (error) {
      if (id !== this.request || profile !== this.store.profile()) return;
      this.store.set({ ...this.store.get(), loading: false, loadingMore: false, error: errorText(error) });
    }
  }

  /** desktop `loadMoreSessions`: raise the window by a page and read it again */
  async loadMore() {
    const state = this.store.get();
    if (state.loadingMore || !state.hasMore) return;
    this.limit = widened(this.limit);
    this.store.set({ ...state, loadingMore: true });
    await this.refresh();
  }

  /** more of the platform sections: the messaging window widens by its own step */
  async loadMoreMessaging() {
    const state = this.store.get();
    if (state.loadingMore || !state.hasMoreMessaging) return;
    this.messagingLimit = widened(this.messagingLimit, MESSAGING_WINDOW);
    this.store.set({ ...state, loadingMore: true });
    await this.refresh();
  }

  search(query: string) {
    return this.lister.search(query, this.store.profile());
  }

  /** a rename or a generated title lands on the row without a refetch */
  retitle(storedId: string, title: string) {
    const state = this.store.get();
    const apply = (list: SessionInfo[]) => (list.some((s) => s.id === storedId) ? list.map((s) => (s.id === storedId ? { ...s, title } : s)) : list);
    const items = apply(state.items);
    const messaging = apply(state.messaging);
    if (items !== state.items || messaging !== state.messaging) this.store.set({ ...state, items, messaging });
  }
}
