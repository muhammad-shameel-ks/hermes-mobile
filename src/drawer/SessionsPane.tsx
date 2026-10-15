/**
 * The SESSIONS tab (apps/desktop/src/app/chat/sidebar/index.tsx): the nav rows, the search field, then
 * Pinned, the date-grouped Sessions, and a section per messaging platform. A query replaces them with
 * Results, ranked by the server's full-text search. No projects, no cron section and no messaging row
 * (issues #12, #15, #16).
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useOverlay } from '../app/overlay.tsx';
import type { ChatSnapshot, SessionInfo } from '../chat/controller.ts';
import { openFiles } from '../files/open.tsx';
import { LoadMoreRow, NavRow, SearchField } from './chrome.tsx';
import { getDrawerFolds, toggleIn, updateFolds, useDrawerFolds } from './drawerState.ts';
import { PlatformChip } from './PlatformChip.tsx';
import { SIDEBAR_INSET } from './rowGeometry.ts';
import { sessionTime } from './sessionDates.ts';
import { buildSessionByAnyId, MESSAGING_INITIAL_ROWS, MESSAGING_LOAD_STEP, mergeSearchResults, messagingGroups, splitPinned, type SessionSearchResult } from './sessionIndex.ts';
import { EmptyMessage, LoadErrorState, PinnedEmptyState, SessionSkeletons, StorageCorruptNotice } from './sectionStates.tsx';
import { SessionRows, SessionsSection, type RowHandlers } from './SessionsSection.tsx';
import { useDrawerRoutes } from './useDrawerRoutes.tsx';
import { useServerSessionSearch } from './useServerSessionSearch.ts';

/** what the list asks of the controller beyond showing rows */
export type SessionsListApi = {
  loadMore: () => void;
  loadMoreMessaging: () => void;
  retry: () => void;
  search: (query: string) => Promise<SessionSearchResult[]>;
};

type Props = {
  snapshot: ChatSnapshot;
  list: SessionsListApi;
  onClose: () => void;
  onNewSession: () => void;
  onOpenSession: (session: SessionInfo) => void;
  onSessionActions: (session: SessionInfo) => void;
};

const byRecency = (a: SessionInfo, b: SessionInfo) => sessionTime(b) - sessionTime(a);

export function SessionsPane({ snapshot, list, onClose, onNewSession, onOpenSession, onSessionActions }: Props) {
  const overlay = useOverlay();
  const routes = useDrawerRoutes(onClose);
  const folds = useDrawerFolds();
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const { matches, pending } = useServerSessionSearch(trimmed, list.search);

  const { items, messaging, loading, loaded, loadingMore, error, hasMore, hasMoreMessaging, corrupt } = snapshot.sessions;
  const minute = Math.floor(Date.now() / 60_000) * 60;
  const split = useMemo(() => splitPinned(items, messaging), [items, messaging]);
  const platforms = useMemo(() => messagingGroups(split.messaging, hasMoreMessaging), [split.messaging, hasMoreMessaging]);
  const sorted = useMemo(() => [...items, ...messaging].sort(byRecency), [items, messaging]);
  const byAnyId = useMemo(() => buildSessionByAnyId(items, messaging), [items, messaging]);
  const results = useMemo(() => mergeSearchResults(sorted, trimmed, matches, byAnyId, pending), [sorted, trimmed, matches, byAnyId, pending]);

  const handlers: RowHandlers = { snapshot, now: minute, onOpen: onOpenSession, onActions: onSessionActions };
  const empty = items.length === 0 && messaging.length === 0;
  const skeletons = !loaded && !error;

  const revealMore = useCallback(
    (sourceId: string, loadedCount: number, more: boolean) => {
      const current = getDrawerFolds().messagingVisible[sourceId] ?? MESSAGING_INITIAL_ROWS;
      const next = current + MESSAGING_LOAD_STEP;
      updateFolds({ messagingVisible: { ...getDrawerFolds().messagingVisible, [sourceId]: next } });
      if (next > loadedCount && more) list.loadMoreMessaging();
    },
    [list],
  );

  const recentsBody = skeletons ? (
    <SessionSkeletons />
  ) : error && empty ? (
    <LoadErrorState onRetry={list.retry} />
  ) : split.recents.length === 0 ? (
    <EmptyMessage>{split.pinned.length > 0 ? 'Everything here is pinned. Unpin a chat to show it in recents.' : 'No sessions yet'}</EmptyMessage>
  ) : (
    <SessionRows sessions={split.recents} grouping="date" preserveOrder={false} handlers={handlers} />
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.nav}>
        <NavRow label="New session" icon="robot" onPress={onNewSession} />
        <NavRow label="Capabilities" icon="symbol-misc" onPress={routes.openCapabilities} />
        <NavRow
          label="Files"
          icon="folder"
          onPress={() => {
            onClose();
            openFiles(overlay);
          }}
        />
      </View>

      {corrupt ? <StorageCorruptNotice /> : null}

      <View style={styles.search}>
        <SearchField value={query} onChange={setQuery} placeholder="Search sessions…" loading={pending && trimmed.length > 0} />
      </View>

      {trimmed ? (
        <SessionsSection label="Results">
          {results.length > 0 ? (
            <SessionRows sessions={results} grouping="none" preserveOrder handlers={handlers} />
          ) : pending ? (
            <SessionSkeletons />
          ) : (
            <EmptyMessage tall>{`No sessions match “${trimmed}”.`}</EmptyMessage>
          )}
        </SessionsSection>
      ) : (
        <>
          <SessionsSection label="Pinned" open={folds.pinsOpen} onToggle={() => updateFolds({ pinsOpen: !folds.pinsOpen })}>
            {split.pinned.length > 0 ? <SessionRows sessions={split.pinned} grouping="none" preserveOrder handlers={handlers} /> : <PinnedEmptyState />}
          </SessionsSection>

          <SessionsSection
            label="Sessions"
            open={folds.recentsOpen}
            onToggle={() => updateFolds({ recentsOpen: !folds.recentsOpen })}
            footer={!skeletons && hasMore ? <LoadMoreRow loading={loadingMore} onPress={list.loadMore} /> : null}
          >
            {recentsBody}
          </SessionsSection>

          {platforms.map((group) => {
            const visible = folds.messagingVisible[group.sourceId] ?? MESSAGING_INITIAL_ROWS;
            const shown = group.sessions.slice(0, visible);
            return (
              <SessionsSection
                key={group.sourceId}
                label={group.label}
                icon={<PlatformChip sourceId={group.sourceId} label={group.label} />}
                open={folds.messagingOpen.includes(group.sourceId)}
                onToggle={() => updateFolds({ messagingOpen: toggleIn(folds.messagingOpen, group.sourceId) })}
                footer={
                  visible < group.sessions.length || group.hasMore ? (
                    <LoadMoreRow
                      loading={loadingMore}
                      step={Math.min(MESSAGING_LOAD_STEP, Math.max(0, group.sessions.length - shown.length))}
                      onPress={() => revealMore(group.sourceId, group.sessions.length, group.hasMore)}
                    />
                  ) : null
                }
              >
                <SessionRows sessions={shown} grouping="none" preserveOrder={false} handlers={handlers} />
              </SessionsSection>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: SIDEBAR_INSET, paddingBottom: 12 },
  nav: { gap: 1, paddingTop: 6, paddingBottom: 8 },
  search: { paddingHorizontal: 8, paddingBottom: 4, paddingTop: 4 },
});
