/**
 * One cell of the sessions list (apps/desktop/src/app/chat/sidebar/sessions-section.tsx): the header
 * that folds a section, a session row, a date divider, the placeholder a section shows instead of
 * rows, the footer that loads more. The list windows these cells; sessionListItems.ts lays them out.
 */

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SessionInfo } from '../chat/controller.ts';
import { DateDivider, LoadMoreRow, SectionHeader } from './chrome.tsx';
import { PlatformChip } from './PlatformChip.tsx';
import { ROW_STACK_GAP } from './rowGeometry.ts';
import { EmptyMessage, LoadErrorState, PinnedEmptyState, SessionSkeletons } from './sectionStates.tsx';
import type { DotState } from './sessionStatus.ts';
import type { FoldTarget, ListItem, MoreTarget } from './sessionListItems.ts';
import { SessionRow } from './SessionRow.tsx';

/** what the cells do; every member is stable for the list's life, so cells never re-render for it */
export type CellActions = {
  toggleFold: (fold: FoldTarget) => void;
  toggleGroup: (groupKey: string) => void;
  loadMore: (target: MoreTarget) => void;
  retry: () => void;
  onOpen: (session: SessionInfo) => void;
  onActions: (session: SessionInfo) => void;
};

type Props = {
  item: ListItem;
  /** rows only: the dot the row paints and whether it is the open chat */
  state: DotState;
  active: boolean;
  /** epoch seconds, rounded to the minute so an unchanged row stays put between ticks */
  now: number;
  actions: CellActions;
};

function SessionListCellImpl({ item, state, active, now, actions }: Props) {
  const gap = (item.kind === 'row' || item.kind === 'divider') && item.gap;
  const style = gap ? (item.end ? styles.gapEnd : styles.gap) : item.end ? styles.end : undefined;
  return <View style={style}>{content(item, state, active, now, actions)}</View>;
}

function content(item: ListItem, state: DotState, active: boolean, now: number, actions: CellActions) {
  switch (item.kind) {
    case 'header': {
      const fold = item.fold;
      return (
        <SectionHeader
          label={item.label}
          open={item.open}
          onToggle={fold ? () => actions.toggleFold(fold) : undefined}
          icon={item.platform ? <PlatformChip sourceId={item.platform} label={item.label} /> : undefined}
        />
      );
    }
    case 'divider':
      return <DateDivider label={item.label} open={item.open} onToggle={() => actions.toggleGroup(item.groupKey)} />;
    case 'row':
      return <SessionRow session={item.session} branchStem={item.branchStem} active={active} state={state} now={now} onOpen={actions.onOpen} onActions={actions.onActions} />;
    case 'state':
      return item.state === 'skeletons' ? (
        <SessionSkeletons />
      ) : item.state === 'load-error' ? (
        <LoadErrorState onRetry={actions.retry} />
      ) : item.state === 'pinned-hint' ? (
        <PinnedEmptyState />
      ) : (
        <EmptyMessage tall={item.state === 'empty-tall'}>{item.text ?? ''}</EmptyMessage>
      );
    case 'more':
      return <LoadMoreRow loading={item.loading} step={item.step} onPress={() => actions.loadMore(item.target)} />;
  }
}

export const SessionListCell = memo(SessionListCellImpl);

const styles = StyleSheet.create({
  gap: { paddingTop: ROW_STACK_GAP },
  end: { paddingBottom: 4 },
  gapEnd: { paddingTop: ROW_STACK_GAP, paddingBottom: 4 },
});
