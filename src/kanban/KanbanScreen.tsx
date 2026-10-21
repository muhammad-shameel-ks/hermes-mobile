/**
 * The Kanban surface: the desktop's `/kanban` board page (`plugins/kanban/board.tsx`) on a phone. The desktop
 * lays the lanes side by side; a phone shows one lane per page and swipes between them, with the lane strip
 * (a pipeline ribbon of every lane's share and a chip per lane) on top. Holding a card lifts it and drops a
 * dock of lanes over the board to move it (`board/drag.tsx`); letting go in place opens its actions. Tap
 * opens the task; "Select" starts a selection, with the bulk bar along the bottom.
 *
 * The board polls while the screen is on (the desktop's socket is not ported) and every write paints first,
 * then reconciles on the next read. Parity deviations are recorded in docs/kanban-parity.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayScreen } from '../app/overlay.tsx';
import { gateway } from '../files/gateway.ts';
import { errorMessage } from '../files/rest.ts';
import { EmptyState, ErrorBanner, HeaderAction, Loading, useToast } from '../files/ui.tsx';
import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { press } from '../ui/haptics.ts';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { DragGhost, DropDock, useBoardDrag, type DragOutcome } from './board/drag.tsx';
import { LanePage, type LaneState } from './board/LanePage.tsx';
import { LaneRail } from './board/LaneRail.tsx';
import { BoardSheet, FilterSheet, SelectionBar } from './board/sheets.tsx';
import { CardFace, type CardContext } from './board/TaskCard.tsx';
import { buildLaneItems, type LaneItem } from './laneListItems.ts';
import { LiveResource } from './live.ts';
import {
  boardTotal,
  filterBoard,
  filtersActive,
  findTask,
  flowSegments,
  isLockedTarget,
  moveCard,
  NO_FILTERS,
  pruneSelection,
  removeCard,
  shortId,
  stableBoard,
  type BoardFilters,
} from './model.ts';
import type { NewTaskTarget, TaskTarget } from './open.tsx';
import { setKanbanPrefs, setSelectedBoard, useKanbanPrefs } from './prefs.ts';
import { createKanbanRest, isPluginOff } from './rest.ts';
import { K, laneLabel, lockedReason } from './text.ts';
import type { BoardsResponse, KanbanBoard, KanbanColumn, KanbanProfile, OrchestrationSettings } from './types.ts';
import { LaneSheet, ProfileSheet, useLive } from './ui.tsx';
import { useKanbanVersion } from './version.ts';

/** the dashboard's board poll; the desktop's socket makes it instant, the phone has only this */
const BOARD_POLL_MS = 8000;
/** card ages and the heartbeat check move in minutes, so the cards' shared context changes at most once a minute */
const CONTEXT_TICK_S = 60;

const NO_SELECTION: ReadonlySet<string> = new Set();

/** the action sheet's fade-out, before a sheet it hands to may present */
const SHEET_HANDOFF_MS = 280;
type Props = {
  onClose: () => void;
  onOpenTask: (target: TaskTarget) => void;
  onNewTask: (target: NewTaskTarget) => void;
};

export default function KanbanScreen({ onClose, onOpenTask, onNewTask }: Props) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { api, auth, profile } = gateway();
  const prefs = useKanbanPrefs();
  const slug = prefs.boards[auth.baseUrl] ?? '';

  const [archived, setArchived] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [activeLane, setActiveLane] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'boards' | 'filters' | 'bulkMove' | 'bulkAssign' | null>(null);
  const [boards, setBoards] = useState<BoardsResponse | null>(null);
  const [profiles, setProfiles] = useState<KanbanProfile[]>([]);
  const [orchestration, setOrchestration] = useState<OrchestrationSettings | null>(null);
  const toast = useToast(selected.size > 0 ? 64 : 0);

  const rest = useMemo(() => createKanbanRest(api, { profile, board: () => slug }), [api, profile, slug]);
  useEffect(() => () => rest.dispose(), [rest]);

  const live = useMemo(() => {
    const resource: LiveResource<KanbanBoard> = new LiveResource({
      load: async () => stableBoard(resource.getSnapshot().data, await rest.board(archived)),
      intervalMs: () => BOARD_POLL_MS,
    });
    return resource;
  }, [rest, archived]);
  const { data: board, error } = useLive(live);

  // a write on a task's screen refreshes the board under it
  const version = useKanbanVersion();
  const seenVersion = useRef(version);
  useEffect(() => {
    if (version === seenVersion.current) return;
    seenVersion.current = version;
    void live.refresh();
  }, [version, live]);

  // the roster, the dispatcher's defaults and the boards: read once per board, after the first render
  useEffect(() => {
    let alive = true;
    void rest.profiles().then((r) => alive && setProfiles(r.profiles), () => undefined);
    void rest.orchestration().then((r) => alive && setOrchestration(r), () => undefined);
    void rest.boards().then((r) => alive && setBoards(r), () => undefined);
    return () => {
      alive = false;
    };
  }, [rest]);

  const filtered = useMemo(() => (board ? filterBoard(board, filters) : null), [board, filters]);
  const segments = useMemo(() => (filtered ? flowSegments(filtered) : []), [filtered]);
  const lanes = useMemo(() => (filtered ? filtered.columns.map((col) => col.name) : []), [filtered]);
  const counts = useMemo(() => Object.fromEntries(segments.map((s) => [s.name, s.count])), [segments]);
  const total = filtered ? boardTotal(filtered) : 0;

  // the first page is the first lane with cards; afterwards the reader's lane is kept across polls
  const activeIndex = Math.max(0, activeLane ? lanes.indexOf(activeLane) : segments.findIndex((s) => s.count > 0));

  // lane cell models, rebuilt only for a lane whose card list changed (stableBoard keeps the rest by identity)
  const groupRunning = prefs.groupRunning;
  const itemCache = useRef({ groupRunning, items: new WeakMap<KanbanColumn['tasks'], LaneItem[]>() });
  // a cache only: a render React discards cannot leave it wrong
  if (itemCache.current.groupRunning !== groupRunning) itemCache.current = { groupRunning, items: new WeakMap() };
  const itemsFor = (col: KanbanColumn): LaneItem[] => {
    let items = itemCache.current.items.get(col.tasks);
    if (!items) {
      items = buildLaneItems(col.name, col.tasks, groupRunning);
      itemCache.current.items.set(col.tasks, items);
    }
    return items;
  };

  const minute = Math.floor(Date.now() / 1000 / CONTEXT_TICK_S);
  const context = useMemo<CardContext>(
    () => ({
      fallback: orchestration?.default_assignee.trim() ?? '',
      orchestrator: orchestration?.resolved_orchestrator_profile ?? '',
      nowSeconds: minute * CONTEXT_TICK_S,
    }),
    [orchestration, minute],
  );

  // drop selected ids that left the board, so the bar's count never lies about what a bulk op hits
  useEffect(() => {
    if (board) setSelected((prev) => pruneSelection(prev, board));
  }, [board]);

  const latest = useRef({ board, selected, slug, lanes, onOpenTask });
  latest.current = { board, selected, slug, lanes, onOpenTask };

  // ─── writes ────────────────────────────────────────────────────────────────

  const move = useCallback(
    async (id: string, lane: string) => {
      const task = findTask(latest.current.board, id);
      if (!task || task.status === lane) return;
      if (isLockedTarget(lane)) {
        toast.show(lockedReason(lane), 'error');
        return;
      }
      const previous = live.update((b) => moveCard(b, id, lane));
      try {
        await rest.patchTask(id, { status: lane });
        toast.show(K.moved(laneLabel(lane)));
      } catch (e) {
        live.restore(previous);
        toast.show(errorMessage(e), 'error');
      }
      void live.refresh();
    },
    [live, rest, toast],
  );

  const remove = useCallback(
    (id: string) => {
      const task = findTask(latest.current.board, id);
      Alert.alert(`${K.delete} “${task?.title || shortId(id)}”?`, undefined, [
        { text: K.cancel, style: 'cancel' },
        {
          text: K.delete,
          style: 'destructive',
          onPress: () => {
            const previous = live.update((b) => removeCard(b, id));
            rest.deleteTask(id).then(
              () => toast.show(K.deleted),
              (e: unknown) => {
                live.restore(previous);
                toast.show(errorMessage(e), 'error');
              },
            );
            void live.refresh();
          },
        },
      ]);
    },
    [live, rest, toast],
  );

  /** per-id outcomes: failed cards stay selected, as on the desktop */
  const finishBulk = (failed: Array<{ id: string; error?: string }>, size: number) => {
    setBulkBusy(false);
    void live.refresh();
    if (failed.length > 0) toast.show(K.bulkFailed(failed.length, size, failed[0].error ?? K.refused), 'error');
    setSelected(failed.length ? new Set(failed.map((f) => f.id)) : NO_SELECTION);
  };

  const bulk = async (patch: Record<string, unknown>) => {
    const ids = [...selected];
    setBulkBusy(true);
    try {
      const { results } = await rest.bulk(ids, patch);
      finishBulk(results.filter((r) => !r.ok), ids.length);
    } catch (e) {
      setBulkBusy(false);
      toast.show(errorMessage(e), 'error');
    }
  };

  // the backend has no bulk delete: fan out per id, with the same partial-failure story
  const bulkDelete = () => {
    const ids = [...selected];
    Alert.alert(`${K.delete} ${K.nSelected(ids.length)}?`, undefined, [
      { text: K.cancel, style: 'cancel' },
      {
        text: K.delete,
        style: 'destructive',
        onPress: () => {
          setBulkBusy(true);
          void Promise.allSettled(ids.map((id) => rest.deleteTask(id))).then((settled) =>
            finishBulk(
              ids.flatMap((id, i) => {
                const result = settled[i];
                return result.status === 'rejected' ? [{ id, error: errorMessage(result.reason) }] : [];
              }),
              ids.length,
            ),
          );
        },
      },
    ]);
  };

  const createBoard = async (newSlug: string, name: string): Promise<string | null> => {
    try {
      const result = await rest.createBoard(newSlug, name);
      setSelectedBoard(auth.baseUrl, result.board.slug);
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  };

  // ─── navigation ────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const openTask = useCallback((id: string) => {
    const { slug: board, onOpenTask: open } = latest.current;
    open({ id, board, columns: latest.current.board?.columns.map((col) => col.name) ?? latest.current.lanes });
  }, []);

  const onTap = useCallback(
    (id: string) => {
      if (latest.current.selected.size > 0) toggleSelect(id);
      else openTask(id);
    },
    [toggleSelect, openTask],
  );

  const newTask = useCallback(
    (lane: string) => {
      const cards = latest.current.board?.columns.flatMap((col) => col.tasks) ?? [];
      onNewTask({ board: latest.current.slug, lane, parents: cards.map((task) => ({ id: task.id, title: task.title })) });
    },
    [onNewTask],
  );

  const onDrop = useCallback(
    (outcome: DragOutcome) => {
      if (outcome.kind === 'move') void move(outcome.id, outcome.lane);
      else if (outcome.kind === 'menu') setMenuFor(outcome.id);
      else toast.show(lockedReason(outcome.lane), 'error');
    },
    [move, toast],
  );

  const laneOf = useCallback((id: string) => findTask(latest.current.board, id)?.status, []);
  const drag = useBoardDrag(lanes, laneOf, onDrop);
  const draggedTask = drag.dragging ? findTask(board, drag.dragging) : undefined;

  const pager = useRef<FlatList<KanbanColumn>>(null);
  const selectLane = useCallback(
    (index: number) => {
      const lane = lanes[index];
      if (!lane) return;
      setActiveLane(lane);
      pager.current?.scrollToOffset({ offset: index * width, animated: true });
    },
    [lanes, width],
  );
  const onPageEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const lane = lanes[Math.round(event.nativeEvent.contentOffset.x / width)];
      if (lane) setActiveLane(lane);
    },
    [lanes, width],
  );

  const refresh = useCallback(() => live.refresh(), [live]);
  const laneState = useMemo<LaneState>(() => ({ context, selected, lifted: drag.dragging }), [context, selected, drag.dragging]);

  const renderLane = ({ item }: { item: KanbanColumn }) => (
    <LanePage
      lane={item.name}
      items={itemsFor(item)}
      state={laneState}
      width={width}
      bottomInset={insets.bottom + (selected.size > 0 ? 64 : 0)}
      api={drag.api}
      onTap={onTap}
      onMenu={setMenuFor}
      onAdd={newTask}
      onRefresh={refresh}
    />
  );

  // ─── chrome ────────────────────────────────────────────────────────────────

  const currentBoard = boards?.boards.find((b) => b.slug === (slug || boards.current));
  const boardName = currentBoard?.name || currentBoard?.slug || slug || K.board;
  const filtering = Boolean(filters.tenant || filters.assignee || archived);
  const menuTask = menuFor ? findTask(board, menuFor) : undefined;
  const moveTask = moveFor ? findTask(board, moveFor) : undefined;

  const menuActions: SheetAction[] = menuTask
    ? [
        { label: K.open, onPress: () => openTask(menuTask.id) },
        { label: K.select, onPress: () => toggleSelect(menuTask.id) },
        // after the action sheet's modal has gone: iOS will not present a second modal while one dismisses
        { label: `${K.moveToShort}…`, onPress: () => setTimeout(() => setMoveFor(menuTask.id), SHEET_HANDOFF_MS) },
        { label: K.delete, destructive: true, onPress: () => remove(menuTask.id) },
      ]
    : [];

  const openSheet = (next: typeof sheet) => {
    press();
    setSheet(next);
    // the switcher's counts move with the board: re-read after the sheet's render
    if (next === 'boards') setTimeout(() => void rest.boards().then(setBoards, () => undefined), 0);
  };

  const body = () => {
    if (!board) {
      if (error && isPluginOff(error)) return <EmptyState title={K.pluginOff} body={K.pluginOffBody} primary={{ label: 'Retry', onPress: () => void live.refresh() }} />;
      if (error) return <EmptyState title={errorMessage(error)} tone="warning" primary={{ label: 'Retry', onPress: () => void live.refresh() }} />;
      return <Loading label="Loading board…" />;
    }
    if (total === 0) {
      const narrowed = filtersActive(filters) || archived;
      return (
        <EmptyState
          title={narrowed ? K.noMatch : K.noTasks}
          primary={{ label: K.newTask, onPress: () => newTask('triage') }}
          secondary={narrowed ? { label: 'Clear filters', onPress: () => (setFilters(NO_FILTERS), setArchived(false)) } : undefined}
        />
      );
    }
    return (
      <>
        <LaneRail segments={segments} active={activeIndex} onSelect={selectLane} />
        {!prefs.introDismissed ? (
          <View style={[styles.intro, { backgroundColor: t.uiBgQuinary, borderRadius: t.radius.lg }]}>
            <Text style={[styles.introText, { color: t.uiTextSecondary }]}>{K.intro}</Text>
            <Pressable onPress={() => setKanbanPrefs({ introDismissed: true })} hitSlop={8} accessibilityRole="button" style={styles.introButton}>
              <Text style={{ color: t.uiTextPrimary, fontSize: 12.5, fontWeight: '600' }}>{K.introGotIt}</Text>
            </Pressable>
          </View>
        ) : null}
        <FlatList
          ref={pager}
          data={filtered?.columns ?? []}
          keyExtractor={(col) => col.name}
          renderItem={renderLane}
          extraData={laneState}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={activeIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={onPageEnd}
          windowSize={3}
          initialNumToRender={1}
          style={styles.pager}
        />
      </>
    );
  };

  return (
    <OverlayScreen
      title={K.title}
      onBack={onClose}
      trailing={
        <View style={styles.actions}>
          <HeaderAction icon="search" label={K.filterCards} onPress={() => setSearching((on) => !on)} />
          <View>
            <HeaderAction icon="filter" label={K.filters} onPress={() => openSheet('filters')} disabled={!board} />
            {filtering ? <View pointerEvents="none" style={[styles.badge, { backgroundColor: t.uiAccent }]} /> : null}
          </View>
          <HeaderAction icon="add" label={K.newTask} onPress={() => newTask('triage')} disabled={!board} />
        </View>
      }
    >
      <View ref={drag.rootRef} onLayout={drag.measureRoot} style={styles.root} collapsable={false}>
        {searching ? (
          <View style={[styles.bar, { borderBottomColor: t.uiStrokeQuaternary }]}>
            <Codicon name="search" size={14} color={t.uiTextTertiary} />
            <TextInput
              autoFocus
              value={filters.search}
              onChangeText={(search) => setFilters((f) => ({ ...f, search }))}
              placeholder={K.filterCards}
              placeholderTextColor={t.uiTextQuaternary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={K.filterCards}
              style={[styles.search, { color: t.uiTextPrimary }]}
            />
            <Pressable
              onPress={() => {
                setFilters((f) => ({ ...f, search: '' }));
                setSearching(false);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Codicon name="close" size={14} color={t.uiTextTertiary} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => openSheet('boards')}
            accessibilityRole="button"
            accessibilityLabel={`${K.switchBoard}: ${boardName}`}
            style={({ pressed }) => [styles.bar, { borderBottomColor: t.uiStrokeQuaternary }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
          >
            <Codicon name="project" size={14} color={t.uiTextTertiary} />
            <Text numberOfLines={1} style={[styles.boardName, { color: t.uiTextPrimary }]}>
              {boardName}
            </Text>
            <Codicon name="chevron-down" size={12} color={t.uiTextTertiary} />
            {board ? (
              <View style={[styles.total, { backgroundColor: mixPct(t.uiBase, 0.08, 'transparent'), borderRadius: t.radius.full }]}>
                <Text style={{ color: t.uiTextTertiary, fontSize: 11, fontVariant: ['tabular-nums'] }}>{total}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
        {error && board ? <ErrorBanner text={errorMessage(error)} /> : null}
        {body()}

        {drag.dragging ? <DropDock lanes={lanes} counts={counts} own={draggedTask?.status} hovered={drag.hovered} setRect={drag.setRect} /> : null}
        {draggedTask ? (
          <DragGhost drag={drag} width={width - 24}>
            <CardFace task={draggedTask} context={context} selected={false} still />
          </DragGhost>
        ) : null}

        {selected.size > 0 ? (
          <SelectionBar
            count={selected.size}
            busy={bulkBusy}
            bottomInset={insets.bottom}
            onMove={() => setSheet('bulkMove')}
            onAssign={() => setSheet('bulkAssign')}
            onArchive={() => void bulk({ archive: true })}
            onDelete={bulkDelete}
            onClear={() => setSelected(NO_SELECTION)}
          />
        ) : null}
        {toast.node}
      </View>

      <ActionSheet visible={menuTask !== undefined} title={menuTask?.title || shortId(menuFor)} subtitle={menuTask ? laneLabel(menuTask.status) : undefined} actions={menuActions} onClose={() => setMenuFor(null)} />
      <LaneSheet
        visible={moveTask !== undefined}
        title={K.moveToShort}
        columns={board?.columns.map((col) => col.name) ?? []}
        current={moveTask?.status ?? null}
        onPick={(lane) => moveTask && void move(moveTask.id, lane)}
        onClose={() => setMoveFor(null)}
      />
      <LaneSheet
        visible={sheet === 'bulkMove'}
        title={`${K.moveToShort} · ${K.nSelected(selected.size)}`}
        columns={board?.columns.map((col) => col.name) ?? []}
        current={null}
        onPick={(lane) => void bulk({ status: lane })}
        onClose={() => setSheet(null)}
      />
      <ProfileSheet
        visible={sheet === 'bulkAssign'}
        title={`${K.assign} · ${K.nSelected(selected.size)}`}
        profiles={profiles}
        current={null}
        trailing={[{ key: 'unassign', label: K.unassignAction, profile: null }]}
        onPick={(choice) => void bulk({ assignee: choice.profile ?? '', reclaim_first: true })}
        onClose={() => setSheet(null)}
      />
      <BoardSheet
        visible={sheet === 'boards'}
        boards={boards}
        current={slug}
        onSelect={(next) => {
          setSelected(NO_SELECTION);
          setActiveLane(null);
          setSelectedBoard(auth.baseUrl, next);
        }}
        onCreate={createBoard}
        onClose={() => setSheet(null)}
      />
      <FilterSheet
        visible={sheet === 'filters'}
        assignees={board?.assignees ?? []}
        tenants={board?.tenants ?? []}
        assignee={filters.assignee}
        tenant={filters.tenant}
        archived={archived}
        groupRunning={prefs.groupRunning}
        onAssignee={(assignee) => setFilters((f) => ({ ...f, assignee }))}
        onTenant={(tenant) => setFilters((f) => ({ ...f, tenant }))}
        onArchived={setArchived}
        onGroupRunning={(on) => setKanbanPrefs({ groupRunning: on })}
        onClose={() => setSheet(null)}
      />
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  badge: { position: 'absolute', top: 9, right: 8, width: 6, height: 6, borderRadius: 3 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  boardName: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  total: { paddingHorizontal: 7, paddingVertical: 1, marginLeft: 2 },
  search: { flex: 1, fontSize: 15, paddingVertical: 8 },
  intro: { marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  introText: { fontSize: 12.5, lineHeight: 18 },
  introButton: { alignSelf: 'flex-start' },
  pager: { flex: 1 },
});
