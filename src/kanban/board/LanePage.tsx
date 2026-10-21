/**
 * One lane, one page of the board pager: the lane's help line (the desktop's header tip), its cards (with
 * the Running lane grouped by worker when asked), and the dashed "new task here" slot the desktop fades in
 * on hover, always shown on a phone. The dispatcher's lanes take no new tasks. A windowed list over the
 * lane's flat cell model (`laneListItems.ts`).
 */

import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';

import { Codicon } from '../../ui/Codicon.tsx';
import { useTokens } from '../../ui/tokens.ts';
import { usePullRefresh } from '../../ui/usePullRefresh.tsx';
import type { LaneItem } from '../laneListItems.ts';
import { UNASSIGNED_GROUP } from '../laneListItems.ts';
import { isLockedTarget } from '../model.ts';
import { K, laneHelp, laneLabel } from '../text.ts';
import { Avatar } from '../ui.tsx';
import type { DragApi } from './drag.tsx';
import { TaskCard, type CardContext } from './TaskCard.tsx';

export type LaneState = {
  context: CardContext;
  selected: ReadonlySet<string>;
  lifted: string | null;
};

const keyOf = (item: LaneItem) => item.key;

export const LanePage = memo(function LanePage({
  lane,
  items,
  state,
  width,
  bottomInset,
  api,
  onTap,
  onMenu,
  onAdd,
  onRefresh,
}: {
  lane: string;
  items: readonly LaneItem[];
  state: LaneState;
  width: number;
  bottomInset: number;
  api: DragApi;
  onTap: (id: string) => void;
  onMenu: (id: string) => void;
  onAdd: (lane: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const t = useTokens();
  const [pulling, setPulling] = useState(false);
  const refresh = useCallback(() => {
    setPulling(true);
    void onRefresh().finally(() => setPulling(false));
  }, [onRefresh]);
  const pull = usePullRefresh({ refreshing: pulling, onRefresh: refresh });
  const locked = isLockedTarget(lane);
  const selecting = state.selected.size > 0;

  const renderItem = useCallback(
    ({ item }: { item: LaneItem }) =>
      item.kind === 'group' ? (
        <View style={styles.group}>
          {item.assignee !== UNASSIGNED_GROUP ? <Avatar name={item.assignee} size={14} /> : null}
          <Text style={[styles.groupLabel, { color: t.uiTextQuaternary }]}>{item.assignee}</Text>
          <Text style={[styles.groupLabel, { color: t.uiTextQuaternary }]}>{item.count}</Text>
        </View>
      ) : (
        <TaskCard
          task={item.task}
          context={state.context}
          selected={state.selected.has(item.task.id)}
          selecting={selecting}
          lifted={state.lifted === item.task.id}
          api={api}
          onTap={onTap}
          onMenu={onMenu}
        />
      ),
    [t, state, selecting, api, onTap, onMenu],
  );

  return (
    <FlatList
      style={{ width }}
      data={items}
      keyExtractor={keyOf}
      renderItem={renderItem}
      extraData={state}
      refreshControl={pull.refreshControl}
      onScroll={pull.track}
      scrollEventThrottle={16}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={
        <>
          {pull.header}
          <Text style={[styles.help, { color: t.uiTextQuaternary }]}>{laneHelp(lane)}</Text>
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={{ color: t.uiTextQuaternary, fontSize: 12 }}>{locked ? K.laneEmptyLocked : K.empty}</Text>
        </View>
      }
      ListFooterComponent={
        locked ? null : (
          <Pressable
            onPress={() => onAdd(lane)}
            accessibilityRole="button"
            accessibilityLabel={K.newTaskIn(laneLabel(lane))}
            style={({ pressed }) => [
              styles.add,
              { borderColor: t.uiStrokeSecondary, borderRadius: t.radius.md },
              pressed && { backgroundColor: t.uiControlHoverBackground },
            ]}
          >
            <Codicon name="add" size={13} color={t.uiTextTertiary} />
            <Text style={{ color: t.uiTextTertiary, fontSize: 12.5 }}>{K.newTaskIn(laneLabel(lane))}</Text>
          </Pressable>
        )
      }
    />
  );
});

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 12, paddingTop: 4, flexGrow: 1 },
  help: { fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 10 },
  gap: { height: 8 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingTop: 6 },
  groupLabel: { fontSize: 11, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', paddingVertical: 32 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 10, borderWidth: 1, borderStyle: 'dashed' },
});
