/**
 * Drag-to-move, the phone's answer to the desktop's card drag between columns. One lane fills the screen,
 * so the other lanes cannot be drop targets in place: holding a card lifts it, and a dock of every lane
 * drops over the top of the board. Drag the card onto a lane's tile and let go to move it there. The
 * dispatcher's lanes (Running, Review, Scheduled) sit in the dock closed, saying why, as the desktop's
 * no-drop cursor does. Let go without moving and the card's actions open instead.
 *
 * The finger is tracked on the UI thread (shared values, one ghost style for the whole board); React hears
 * only the lift, a change of hovered tile and the drop.
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Codicon } from '../../ui/Codicon.tsx';
import { mixPct } from '../../ui/color.ts';
import { press, tick } from '../../ui/haptics.ts';
import { useTokens } from '../../ui/tokens.ts';
import { isLockedTarget, laneTone } from '../model.ts';
import { K, laneLabel, lockedReason } from '../text.ts';

/** how long a card is held before it lifts */
const LIFT_MS = 320;
/** travel under which a release counts as "held, not dragged" */
const MOVE_SLOP = 12;

type DockRect = { x: number; y: number; w: number; h: number };

/** what each card's gesture writes into; one per board, identity-stable */
export type DragApi = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  grabX: SharedValue<number>;
  grabY: SharedValue<number>;
  hover: SharedValue<number>;
  active: SharedValue<number>;
  rects: SharedValue<DockRect[]>;
  begin: (id: string) => void;
  hoverChanged: (index: number) => void;
  end: (id: string, index: number, moved: boolean) => void;
  cancel: () => void;
};

function hitTest(rects: DockRect[], x: number, y: number): number {
  'worklet';
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r !== undefined && r.w > 0 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** a card's gestures: tap opens (or toggles while selecting), hold-and-drag moves; the drag is off while selecting */
export function useCardGesture(api: DragApi, id: string, draggable: boolean, onTap: (id: string) => void) {
  return useMemo(() => {
    const tap = Gesture.Tap()
      .maxDuration(LIFT_MS)
      .runOnJS(true)
      .onEnd((_event, success) => {
        if (success) onTap(id);
      });
    const pan = Gesture.Pan()
      .enabled(draggable)
      .maxPointers(1)
      .activateAfterLongPress(LIFT_MS)
      .onStart((event) => {
        api.grabX.value = event.x;
        api.grabY.value = event.y;
        api.x.value = event.absoluteX;
        api.y.value = event.absoluteY;
        api.hover.value = -1;
        api.active.value = 1;
        scheduleOnRN(api.begin, id);
      })
      .onUpdate((event) => {
        api.x.value = event.absoluteX;
        api.y.value = event.absoluteY;
        const index = hitTest(api.rects.value, event.absoluteX, event.absoluteY);
        if (index !== api.hover.value) {
          api.hover.value = index;
          scheduleOnRN(api.hoverChanged, index);
        }
      })
      .onEnd((event, success) => {
        api.active.value = 0;
        if (success) scheduleOnRN(api.end, id, api.hover.value, Math.hypot(event.translationX, event.translationY) > MOVE_SLOP);
        else scheduleOnRN(api.cancel);
      });
    return Gesture.Exclusive(pan, tap);
  }, [api, id, draggable, onTap]);
}

export type DragOutcome =
  /** dropped on an open lane other than its own */
  | { kind: 'move'; id: string; lane: string }
  /** held and let go in place */
  | { kind: 'menu'; id: string }
  /** dropped on a closed lane: say why */
  | { kind: 'locked'; lane: string };

export type BoardDrag = {
  api: DragApi;
  /** the card in the air */
  dragging: string | null;
  /** the dock tile under the finger */
  hovered: string | null;
  /** the board body, measured so the ghost can sit under the finger */
  rootRef: RefObject<View | null>;
  measureRoot: () => void;
  rootX: SharedValue<number>;
  rootY: SharedValue<number>;
  /** a dock tile's window rect, as it lays out */
  setRect: (index: number, rect: DockRect) => void;
};

/**
 * The board's drag state. `lanes` are the dock's tiles in order; `laneOf` finds a card's own lane; `onDrop`
 * hears the outcome.
 */
export function useBoardDrag(lanes: readonly string[], laneOf: (id: string) => string | undefined, onDrop: (outcome: DragOutcome) => void): BoardDrag {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const hover = useSharedValue(-1);
  const active = useSharedValue(0);
  const rects = useSharedValue<DockRect[]>([]);
  const rootX = useSharedValue(0);
  const rootY = useSharedValue(0);
  const rootRef = useRef<View | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // the gesture callbacks are created once per card; they read the latest lanes and handlers through here
  const latest = useRef({ lanes, laneOf, onDrop });
  latest.current = { lanes, laneOf, onDrop };

  const measureRoot = useCallback(() => {
    rootRef.current?.measureInWindow((left, top) => {
      rootX.value = left;
      rootY.value = top;
    });
  }, [rootX, rootY]);

  const setRect = useCallback(
    (index: number, rect: DockRect) => {
      const next = rects.value.slice();
      next[index] = rect;
      rects.value = next;
    },
    [rects],
  );

  const api = useMemo<DragApi>(
    () => ({
      x,
      y,
      grabX,
      grabY,
      hover,
      active,
      rects,
      begin: (id) => {
        press();
        rects.value = [];
        measureRoot();
        setHovered(null);
        setDragging(id);
      },
      hoverChanged: (index) => {
        const lane = latest.current.lanes[index] ?? null;
        if (lane) tick();
        setHovered(lane);
      },
      end: (id, index, moved) => {
        setDragging(null);
        setHovered(null);
        const lane = latest.current.lanes[index];
        const own = latest.current.laneOf(id);
        if (lane && lane !== own) {
          if (isLockedTarget(lane)) latest.current.onDrop({ kind: 'locked', lane });
          else latest.current.onDrop({ kind: 'move', id, lane });
        } else if (!moved) {
          latest.current.onDrop({ kind: 'menu', id });
        }
      },
      cancel: () => {
        setDragging(null);
        setHovered(null);
      },
    }),
    [x, y, grabX, grabY, hover, active, rects, measureRoot],
  );

  return { api, dragging, hovered, rootRef, measureRoot, rootX, rootY, setRect };
}

/** the lifted card, following the finger at the point it was picked up */
export function DragGhost({ drag, width, children }: { drag: BoardDrag; width: number; children: ReactNode }) {
  const { x, y, grabX, grabY } = drag.api;
  const { rootX, rootY } = drag;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - rootX.value - grabX.value }, { translateY: y.value - rootY.value - grabY.value }, { rotate: '-2deg' }, { scale: 1.03 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.ghost, { width }, style]}>
      {children}
    </Animated.View>
  );
}

/** the lanes as drop tiles, three to a row, over the top of the board while a card is held */
export const DropDock = memo(function DropDock({
  lanes,
  counts,
  own,
  hovered,
  setRect,
}: {
  lanes: readonly string[];
  counts: Readonly<Record<string, number>>;
  /** the held card's lane */
  own: string | undefined;
  hovered: string | null;
  setRect: (index: number, rect: DockRect) => void;
}) {
  const t = useTokens();
  const hint = hovered && hovered !== own && isLockedTarget(hovered) ? lockedReason(hovered) : hovered && hovered !== own ? K.moveTo(laneLabel(hovered)) : K.dropHere;
  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(120)}
      pointerEvents="none"
      style={[styles.dock, { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary }]}
    >
      <Text numberOfLines={2} style={[styles.dockHint, { color: t.uiTextSecondary }]}>
        {hint}
      </Text>
      <View style={styles.grid}>
        {lanes.map((lane, index) => (
          <DockTile key={lane} lane={lane} index={index} count={counts[lane] ?? 0} own={lane === own} hovered={lane === hovered} setRect={setRect} />
        ))}
      </View>
    </Animated.View>
  );
});

const DockTile = memo(function DockTile({
  lane,
  index,
  count,
  own,
  hovered,
  setRect,
}: {
  lane: string;
  index: number;
  count: number;
  own: boolean;
  hovered: boolean;
  setRect: (index: number, rect: DockRect) => void;
}) {
  const t = useTokens();
  const ref = useRef<View>(null);
  const tone = laneTone(lane, t);
  const locked = !own && isLockedTarget(lane);
  const live = hovered && !own && !locked;
  return (
    <View
      ref={ref}
      onLayout={() => ref.current?.measureInWindow((x, y, w, h) => setRect(index, { x, y, w, h }))}
      style={[
        styles.tile,
        {
          borderRadius: t.radius.md,
          borderColor: live ? tone : own ? t.uiStrokePrimary : t.uiStrokeTertiary,
          borderStyle: own ? 'dashed' : 'solid',
          backgroundColor: live ? mixPct(tone, 0.22, 'transparent') : t.uiBgQuinary,
          opacity: locked ? 0.45 : 1,
        },
      ]}
    >
      <View style={styles.tileHead}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text numberOfLines={1} style={[styles.tileLabel, { color: live ? tone : t.uiTextSecondary }]}>
          {laneLabel(lane)}
        </Text>
        {locked ? <Codicon name="lock" size={10} color={t.uiTextQuaternary} /> : null}
      </View>
      <Text style={[styles.tileMeta, { color: t.uiTextQuaternary }]}>{own ? K.here : String(count)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  ghost: { position: 'absolute', left: 0, top: 0, zIndex: 20, elevation: 12, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  dock: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 6,
    zIndex: 10,
    elevation: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  dockHint: { fontSize: 12, lineHeight: 16, marginBottom: 8, minHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: '31.9%', minHeight: 54, paddingHorizontal: 8, paddingVertical: 8, borderWidth: 1, justifyContent: 'space-between' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileLabel: { flex: 1, fontSize: 12, fontWeight: '600' },
  tileMeta: { fontSize: 10.5, fontVariant: ['tabular-nums'], marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
