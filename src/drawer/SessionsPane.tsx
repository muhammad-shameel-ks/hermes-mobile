/**
 * The SESSIONS tab (apps/desktop/src/app/chat/sidebar/index.tsx): the nav rows, the search field, then
 * Pinned, the date-grouped Sessions, and a section per messaging platform. A query replaces them with
 * Results, ranked by the gateway's full-text search. No projects, no cron section and no messaging row
 * (issues #12, #15, #16). The whole tab is one windowed list, so opening the drawer mounts the rows on
 * screen rather than every loaded session.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useOverlay } from '../app/overlay.tsx';
import type { ChatSnapshot, SessionInfo } from '../chat/controller.ts';
import { openFiles } from '../files/open.tsx';
import { NavRow, SearchField } from './chrome.tsx';
import { NO_ACTIVITIES, rowDotState, stableActivities } from './dotStates.ts';
import { getDrawerFolds, toggleIn, updateFolds, useDrawerFolds } from './drawerState.ts';
import { SIDEBAR_INSET } from './rowGeometry.ts';
import { sessionTime, toSessionRows, groupEntriesByRecency, hideCollapsedGroupRows } from './sessionDates.ts';
import { buildSessionByAnyId, MESSAGING_INITIAL_ROWS, MESSAGING_LOAD_STEP, mergeSearchResults, messagingGroups, splitPinned, type SessionSearchResult } from './sessionIndex.ts';
import { buildSessionListItems, type FoldTarget, type ListItem, type MoreTarget } from './sessionListItems.ts';
import { StorageCorruptNotice } from './sectionStates.tsx';
import { SessionListCell, type CellActions } from './SessionsSection.tsx';
import { flattenSessionsWithBranches } from './sessionTree.ts';
import { useDrawerRoutes } from './useDrawerRoutes.tsx';
import { useSessionSearch } from './useSessionSearch.ts';

/** what the list asks of the controller beyond showing rows */
export type SessionsListApi = {
  loadMore: () => void;
  loadMoreMessaging: () => void;
  retry: () => void;
  search: (query: string) => Promise<SessionSearchResult[]>;
};

/** the slices the list reads; a narrower object than the whole snapshot works as well */
export type SessionsPaneSnapshot = Pick<ChatSnapshot, 'sessions' | 'entries' | 'openKey' | 'finishedAway' | 'profile'>;

type Props = {
  snapshot: SessionsPaneSnapshot;
  list: SessionsListApi;
  onClose: () => void;
  onNewSession: () => void;
  onOpenSession: (session: SessionInfo) => void;
  onSessionActions: (session: SessionInfo) => void;
};

const byRecency = (a: SessionInfo, b: SessionInfo) => sessionTime(b) - sessionTime(a);
const NO_SESSIONS: SessionInfo[] = [];
const keyOf = (item: ListItem) => item.key;

export function SessionsPane({ snapshot, list, onClose, onNewSession, onOpenSession, onSessionActions }: Props) {
  const overlay = useOverlay();
  // callers rebuild their callbacks freely; everything memoised below reads the latest through this
  const latest = useRef({ overlay, list, onClose, onNewSession, onOpenSession, onSessionActions });
  latest.current = { overlay, list, onClose, onNewSession, onOpenSession, onSessionActions };
  const close = useCallback(() => latest.current.onClose(), []);
  const routes = useDrawerRoutes(close);
  const folds = useDrawerFolds();
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const { matches, pending } = useSessionSearch(trimmed, list.search);

  const { items, messaging, loaded, loadingMore, error, hasMore, hasMoreMessaging, corrupt } = snapshot.sessions;
  const { openKey, finishedAway, profile } = snapshot;
  const minute = Math.floor(Date.now() / 60_000) * 60;

  const activitiesRef = useRef(NO_ACTIVITIES);
  const activities = stableActivities(activitiesRef.current, snapshot.entries);
  activitiesRef.current = activities;

  const split = useMemo(() => splitPinned(items, messaging), [items, messaging]);
  const platforms = useMemo(() => messagingGroups(split.messaging, hasMoreMessaging), [split.messaging, hasMoreMessaging]);
  const sorted = useMemo(() => (searching ? [...items, ...messaging].sort(byRecency) : NO_SESSIONS), [searching, items, messaging]);
  const byAnyId = useMemo(() => (searching ? buildSessionByAnyId(items, messaging) : new Map<string, SessionInfo>()), [searching, items, messaging]);
  const results = useMemo(() => mergeSearchResults(sorted, trimmed, matches, byAnyId, pending, profile), [sorted, trimmed, matches, byAnyId, pending, profile]);

  const { closedGroups, messagingVisible, messagingOpen } = folds;
  const pinnedRows = useMemo(() => toSessionRows(flattenSessionsWithBranches(split.pinned, { preserveOrder: true })), [split.pinned]);
  const recentEntries = useMemo(() => flattenSessionsWithBranches(split.recents, { preserveOrder: false }), [split.recents]);
  const recentRows = useMemo(() => hideCollapsedGroupRows(groupEntriesByRecency(recentEntries), (key) => !closedGroups.includes(key)), [recentEntries, closedGroups]);
  const resultRows = useMemo(() => (searching ? toSessionRows(flattenSessionsWithBranches(results, { preserveOrder: true })) : []), [searching, results]);
  const platformModels = useMemo(
    () =>
      platforms.map((group) => {
        const visible = messagingVisible[group.sourceId] ?? MESSAGING_INITIAL_ROWS;
        const open = messagingOpen.includes(group.sourceId);
        const shown = open ? group.sessions.slice(0, visible) : NO_SESSIONS;
        return {
          sourceId: group.sourceId,
          label: group.label,
          open,
          rows: toSessionRows(flattenSessionsWithBranches(shown, { preserveOrder: false })),
          footer:
            visible < group.sessions.length || group.hasMore
              ? { loading: loadingMore, step: Math.min(MESSAGING_LOAD_STEP, Math.max(0, group.sessions.length - Math.min(visible, group.sessions.length))), loaded: group.sessions.length, more: group.hasMore }
              : null,
        };
      }),
    [platforms, messagingVisible, messagingOpen, loadingMore],
  );

  const empty = items.length === 0 && messaging.length === 0;
  const skeletons = !loaded && !error;
  const data = useMemo(
    () =>
      buildSessionListItems({
        query: trimmed,
        results: { rows: resultRows, pending },
        pinsOpen: folds.pinsOpen,
        recentsOpen: folds.recentsOpen,
        closedGroups,
        pinned: pinnedRows,
        recents: { rows: recentRows, skeletons, loadError: Boolean(error) && empty, allPinned: split.pinned.length > 0, footer: hasMore ? { loading: loadingMore } : null },
        platforms: platformModels,
      }),
    [trimmed, resultRows, pending, folds.pinsOpen, folds.recentsOpen, closedGroups, pinnedRows, recentRows, skeletons, error, empty, split.pinned.length, hasMore, loadingMore, platformModels],
  );

  const actions = useMemo<CellActions>(() => {
    const revealMore = (sourceId: string, loadedCount: number, more: boolean) => {
      const current = getDrawerFolds().messagingVisible[sourceId] ?? MESSAGING_INITIAL_ROWS;
      const next = current + MESSAGING_LOAD_STEP;
      updateFolds({ messagingVisible: { ...getDrawerFolds().messagingVisible, [sourceId]: next } });
      if (next > loadedCount && more) latest.current.list.loadMoreMessaging();
    };
    return {
      toggleFold: (fold: FoldTarget) => {
        const now = getDrawerFolds();
        if (fold === 'pins') updateFolds({ pinsOpen: !now.pinsOpen });
        else if (fold === 'recents') updateFolds({ recentsOpen: !now.recentsOpen });
        else updateFolds({ messagingOpen: toggleIn(now.messagingOpen, fold.platform) });
      },
      toggleGroup: (groupKey) => updateFolds({ closedGroups: toggleIn(getDrawerFolds().closedGroups, groupKey) }),
      loadMore: (target: MoreTarget) => (target === 'sessions' ? latest.current.list.loadMore() : revealMore(target.platform, target.loaded, target.more)),
      retry: () => latest.current.list.retry(),
      onOpen: (session) => latest.current.onOpenSession(session),
      onActions: (session) => latest.current.onSessionActions(session),
    };
  }, []);

  const rowState = useMemo(() => ({ activities, openKey, finishedAway, now: minute }), [activities, openKey, finishedAway, minute]);
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      const row = item.kind === 'row';
      return (
        <SessionListCell
          item={item}
          state={row ? rowDotState(rowState.activities, rowState.openKey, rowState.finishedAway, item.session) : 'idle'}
          active={row && rowState.openKey === item.session.id}
          now={rowState.now}
          actions={actions}
        />
      );
    },
    [rowState, actions],
  );

  const searchBusy = pending && searching;
  const header = useMemo(
    () => (
      <>
        <View style={styles.nav}>
          <NavRow label="New session" icon="robot" onPress={() => latest.current.onNewSession()} />
          <NavRow label="Capabilities" icon="symbol-misc" onPress={routes.openCapabilities} />
          <NavRow
            label="Files"
            icon="folder"
            onPress={() => {
              latest.current.onClose();
              openFiles(latest.current.overlay);
            }}
          />
        </View>

        {corrupt ? <StorageCorruptNotice /> : null}

        <View style={styles.search}>
          <SearchField value={query} onChange={setQuery} placeholder="Search sessions…" loading={searchBusy} />
        </View>
      </>
    ),
    [routes, corrupt, query, searchBusy],
  );

  return (
    <FlatList
      style={styles.scroll}
      contentContainerStyle={styles.content}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyOf}
      extraData={rowState}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      initialNumToRender={18}
      maxToRenderPerBatch={12}
      windowSize={9}
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: SIDEBAR_INSET, paddingBottom: 12 },
  nav: { gap: 2, paddingTop: 10, paddingBottom: 10 },
  search: { paddingHorizontal: 10, paddingBottom: 4, paddingTop: 4 },
});
