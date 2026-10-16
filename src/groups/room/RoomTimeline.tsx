/**
 * The room's scrollable log: `buildTimeline` rows (each a memoised `RoomMessageRow`), the "show earlier"
 * pill pulling older history in, and the pending-action cards plus the quiet "room is working" row at the
 * tail - exactly where TranscriptPane docks its own ShowEarlier header and PendingApprovals footer.
 *
 * Stick-to-bottom is hand-rolled rather than assistant-ui's: a plain FlatList has no per-row cell
 * measuring to reuse, so this only tracks whether the reader is near the tail and chases it from there.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { Bot } from '../../bots/roster.ts';
import { usePullRefresh } from '../../ui/usePullRefresh.tsx';
import { ScrollToBottomButton } from '../../chat/ScrollToBottomButton.tsx';
import { ShowEarlier } from '../../chat/ShowEarlier.tsx';
import { GlyphSpinner } from '../../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { buildTimeline, type GroupMember, type PendingAction, type TimelineRow } from '../rooms.ts';
import type { RoomEvent } from '../../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { PendingActionCard } from './PendingActionCard.tsx';
import { RoomMessageRow } from './RoomMessage.tsx';
/** within this of the tail the reader is "at the bottom": new rows still scroll into view */
const NEAR_BOTTOM_PX = 72;

type Entry = { row: TimelineRow; continued: boolean };

/** consecutive messages from the same member drop the repeat label and avatar; any other row breaks the run */
function decorate(rows: readonly TimelineRow[]): Entry[] {
  const out: Entry[] = new Array(rows.length);
  let prevId: string | null = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const id = row.kind === 'member' ? (row.member?.memberId ?? row.speaker) : null;
    out[i] = { row, continued: id !== null && id === prevId };
    prevId = id;
  }
  return out;
}

const keyExtractor = (entry: Entry) => entry.row.key;

type Props = {
  events: readonly RoomEvent[];
  members: readonly GroupMember[];
  roster: Readonly<Record<string, Bot>>;
  loadImage: (name: string) => Promise<string | null>;
  more: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  pending: readonly PendingAction[];
  busy: boolean;
  onApprove: (action: Extract<PendingAction, { kind: 'approval' }>, choice: 'once' | 'deny') => void;
  onRetryTask: (taskId: string) => void;
  working: boolean;
};

function RoomTimelineImpl({ events, members, roster, loadImage, more, loadingEarlier, onLoadEarlier, refreshing, onRefresh, pending, busy, onApprove, onRetryTask, working }: Props) {
  const t = useTokens();
  const pull = usePullRefresh({ refreshing, onRefresh });
  const rows = useMemo(() => buildTimeline(events, members), [events, members]);
  const entries = useMemo(() => decorate(rows), [rows]);

  const listRef = useRef<FlatList<Entry>>(null);
  const nearBottom = useRef(true);
  const everLaid = useRef(false);
  const baseline = useRef(entries.length);
  const [jumpVisible, setJumpVisible] = useState(false);
  const [jumpCount, setJumpCount] = useState(0);

  const renderItem = useCallback(
    ({ item }: { item: Entry }) => <RoomMessageRow row={item.row} continued={item.continued} members={members} roster={roster} loadImage={loadImage} />,
    [members, roster, loadImage],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pull.track(event);
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
      const atBottom = distance < NEAR_BOTTOM_PX;
      if (atBottom === nearBottom.current) return;
      nearBottom.current = atBottom;
      if (atBottom) {
        setJumpVisible(false);
        setJumpCount(0);
      } else {
        baseline.current = entries.length;
        setJumpVisible(true);
      }
    },
    [entries.length, pull],
  );

  const onContentSizeChange = useCallback(() => {
    if (!everLaid.current) {
      everLaid.current = true;
      listRef.current?.scrollToEnd({ animated: false });
      return;
    }
    if (nearBottom.current) {
      listRef.current?.scrollToEnd({ animated: true });
      return;
    }
    const added = entries.length - baseline.current;
    setJumpCount((count) => (count === added ? count : added));
  }, [entries.length]);

  const toBottom = useCallback(() => {
    nearBottom.current = true;
    setJumpVisible(false);
    setJumpCount(0);
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // the cards and the working row are measured after the rows around them; keep the tail in view as they settle
  const chaseFooter = useCallback(() => {
    if (nearBottom.current) listRef.current?.scrollToEnd({ animated: false });
  }, []);

  const header = useMemo(
    () => (
      <>
        {pull.header}
        {more ? <ShowEarlier loading={loadingEarlier} onPress={onLoadEarlier} /> : null}
      </>
    ),
    [more, loadingEarlier, onLoadEarlier, pull.header],
  );

  // the last row is the most recent event; it reads as a reply to the newest user turn only when it is one
  const showWorking = working && rows[rows.length - 1]?.kind !== 'member';
  const footer = useMemo(() => {
    if (pending.length === 0 && !showWorking) return null;
    return (
      <View style={styles.footer} onLayout={chaseFooter}>
        {pending.map((action) => (
          <PendingActionCard key={action.key} action={action} members={members} busy={busy} onApprove={onApprove} onRetryTask={onRetryTask} />
        ))}
        {showWorking ? (
          <View style={styles.working}>
            <GlyphSpinner size={12} color={t.uiTextTertiary} />
            <Text style={[styles.workingText, { color: t.uiTextTertiary }]}>{'The room is working…'}</Text>
          </View>
        ) : null}
      </View>
    );
  }, [pending, members, busy, onApprove, onRetryTask, showWorking, t, chaseFooter]);

  return (
    <View style={styles.flex}>
      <FlatList
        ref={listRef}
        data={entries}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        refreshControl={pull.refreshControl}
      />
      <ScrollToBottomButton visible={jumpVisible} count={jumpCount} onPress={toBottom} />
    </View>
  );
}

export const RoomTimeline = memo(RoomTimelineImpl);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 10, paddingBottom: 10 },
  footer: { paddingHorizontal: 20 },
  working: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  workingText: { fontSize: 12.5 },
});
