/**
 * A section of the sessions list and the rows inside it (apps/desktop/src/app/chat/sidebar/
 * sessions-section.tsx): the header that folds it, the date dividers that group a recency list, the
 * branch-nested rows, its footer. The rows' live status comes from the chats the controller holds.
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ChatSnapshot, SessionInfo } from '../chat/controller.ts';
import { DateDivider, SectionHeader } from './chrome.tsx';
import { ROW_STACK_GAP } from './rowGeometry.ts';
import { groupEntriesByRecency, hideCollapsedGroupRows, toSessionRows, type ListRow } from './sessionDates.ts';
import { sessionRowKey } from './sessionIndex.ts';
import { chatActivity, resolveDotState, type DotState } from './sessionStatus.ts';
import { flattenSessionsWithBranches } from './sessionTree.ts';
import { SessionRow } from './SessionRow.tsx';
import { toggleIn, updateFolds, useDrawerFolds } from './drawerState.ts';

/** the status a row paints: the live chat's activity, else the backend's read watermark */
export function sessionDotState(snapshot: Pick<ChatSnapshot, 'entries' | 'openKey' | 'finishedAway'>, session: SessionInfo): DotState {
  const open = snapshot.openKey === session.id;
  return resolveDotState({
    activity: chatActivity(snapshot.entries[session.id]),
    // a session on screen is read; anything else is unread by the backend's watermark or a turn that ended while away
    unread: !open && (session.unread === true || snapshot.finishedAway[session.id] === true),
  });
}

export type RowHandlers = {
  snapshot: Pick<ChatSnapshot, 'entries' | 'openKey' | 'finishedAway'>;
  now: number;
  onOpen: (session: SessionInfo) => void;
  onActions: (session: SessionInfo) => void;
};

/** a section: its folding header over its rows, then whatever hangs off the end of them */
export function SessionsSection({
  label,
  open = true,
  onToggle,
  icon,
  meta,
  children,
  footer,
}: {
  label: string;
  open?: boolean;
  onToggle?: () => void;
  icon?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader label={label} open={open} onToggle={onToggle} icon={icon} meta={meta} />
      {open ? (
        <View style={styles.body}>
          {children}
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Sessions as rows. `grouping: 'date'` folds the date dividers in (the flat recents list); `none` keeps
 * the caller's order (pinned, search results, platform groups, where a divider would be misleading).
 */
export function SessionRows({ sessions, grouping, preserveOrder, handlers }: { sessions: readonly SessionInfo[]; grouping: 'date' | 'none'; preserveOrder: boolean; handlers: RowHandlers }) {
  const { closedGroups } = useDrawerFolds();
  const entries = useMemo(() => flattenSessionsWithBranches(sessions, { preserveOrder }), [sessions, preserveOrder]);
  const rows: ListRow[] = useMemo(() => {
    const all = grouping === 'date' ? groupEntriesByRecency(entries) : toSessionRows(entries);
    return hideCollapsedGroupRows(all, (key) => !closedGroups.includes(key));
  }, [entries, grouping, closedGroups]);
  const toggle = useCallback((key: string) => updateFolds({ closedGroups: toggleIn(closedGroups, key) }), [closedGroups]);

  return (
    <View style={styles.rows}>
      {rows.map((row) =>
        row.kind === 'divider' ? (
          <DateDivider key={`divider:${row.key}`} label={row.label} open={!closedGroups.includes(row.key)} onToggle={() => toggle(row.key)} />
        ) : (
          <SessionRow
            key={sessionRowKey(row.entry.session)}
            session={row.entry.session}
            branchStem={row.entry.branchStem}
            active={handlers.snapshot.openKey === row.entry.session.id}
            state={sessionDotState(handlers.snapshot, row.entry.session)}
            now={handlers.now}
            onOpen={handlers.onOpen}
            onActions={handlers.onActions}
          />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingBottom: 4 },
  body: { paddingTop: 0 },
  rows: { gap: ROW_STACK_GAP },
});
