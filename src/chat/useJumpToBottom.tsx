/**
 * The transcript's FlatList scroll behaviour: following a streaming reply, lifting
 * a sent message to the top, and the jump-to-bottom pill. assistant-ui still
 * places the list on the bottom when a thread opens or switches; following
 * growing content is ours (`TailFollow`), because assistant-ui's follow reads a
 * pinned flag that only a scroll echo refreshes, so a token landing as the
 * reader starts to drag pulls them back down.
 *
 * A send lifts the reader's message to the top of the viewport and the reply
 * streams into the space under it (`anchorMinHeight` pads the content so the
 * offset exists); nothing follows the reply until the reader scrolls or the
 * reply settles. The padding (`LiftPadding`) only shrinks: to where the reader
 * comes to rest, and away once the rows fill it, so a finished reply leaves no
 * blank space to scroll into. The pill shows once the reader is away from the
 * bottom, counts rows below the fold from the cells' own layouts, and on a tap
 * chases the tail until the list re-pins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type CellRendererProps, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ThreadMessage } from '@assistant-ui/react-native';

import { distanceFromBottom, JUMP_SHOW_DISTANCE, LiftPadding, messagesBelow, PINNED_DISTANCE, replacedTail, sentMessage, TailFollow, type RowFrame } from './scroll.ts';
import type { Message } from './transcript.ts';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** an offset inside the scrollable range: an overscroll bounce or a pull-to-refresh is no movement of the list */
const clampOffset = (scrollY: number, viewport: number, content: number) => Math.min(Math.max(0, scrollY), Math.max(0, content - viewport));

const distanceOf = ({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }: ScrollEvent) =>
  distanceFromBottom(contentOffset.y, layoutMeasurement.height, contentSize.height);
const offsetOf = ({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }: ScrollEvent) =>
  clampOffset(contentOffset.y, layoutMeasurement.height, contentSize.height);

/** the room left above the reader's own message when a send lifts it to the top */
const ANCHOR_GAP = 12;

type Anchor = { id: string; top: number | null; lifted: boolean };

export function useJumpToBottom(sessionKey: string, messages: readonly Message[], running: boolean) {
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const frames = useRef(new Map<string, RowFrame>());
  const metrics = useRef({ scrollY: 0, viewport: 0, content: 0 });
  // the offset of the last scroll echo; `metrics.scrollY` may already hold a commanded offset ahead of it
  const echoY = useRef(0);
  const follow = useRef(new TailFollow());
  // the ids are only read while the pill shows, so a streamed token never maps the whole thread
  const latest = useRef({ messages, ids: null as string[] | null });
  if (latest.current.messages !== messages) latest.current = { messages, ids: null };
  const chasing = useRef(false);
  const visibleRef = useRef(false);
  const frame = useRef(0);
  // the frame after a finger lifts, by which momentum has started if there is any
  const restFrame = useRef(0);
  // the frame after a reload replaced the rows, by which they are laid out
  const stepFrame = useRef(0);
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);
  // the message a send lifted to the top, and the content offset it is lifted to
  const anchor = useRef<Anchor | null>(null);
  const pad = useRef(new LiftPadding());
  const padHeight = useRef<number | null>(null);
  const [anchorMinHeight, setAnchorMinHeight] = useState<number | null>(null);
  const tail = useRef({ id: messages.at(-1)?.id ?? null, sessionKey });
  const wasRunning = useRef(running);
  // the frames after a reply settles, by which its settled layout is measured
  const replyFrame = useRef(0);

  const show = useCallback((next: boolean) => {
    if (visibleRef.current === next) return;
    visibleRef.current = next;
    setVisible(next);
  }, []);

  const recount = useCallback(() => {
    if (!visibleRef.current) return;
    const { scrollY, viewport } = metrics.current;
    const current = latest.current;
    current.ids ??= current.messages.map((m) => m.id);
    setCount(messagesBelow(current.ids, frames.current, scrollY + viewport));
  }, []);

  const schedule = useCallback(() => {
    if (frame.current || !visibleRef.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      recount();
    });
  }, [recount]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(restFrame.current);
      cancelAnimationFrame(stepFrame.current);
      cancelAnimationFrame(replyFrame.current);
    },
    [],
  );

  // the padding the content needs now; the setter runs only when the height changes
  const applyPad = useCallback(() => {
    const next = pad.current.minHeight(metrics.current.viewport);
    if (next === padHeight.current) return;
    padHeight.current = next;
    setAnchorMinHeight(next);
  }, []);

  // once the newest row reaches the padded bottom the rows hold the offset themselves
  const fillPad = useCallback(() => {
    const last = latest.current.messages.at(-1);
    const box = last ? frames.current.get(last.id) : undefined;
    if (box) pad.current.rowsReach(box.y + box.height, metrics.current.viewport);
    applyPad();
  }, [applyPad]);

  // the list came to rest at `scrollY`: the padding never holds the content open past what keeps it there
  const rested = useCallback(
    (scrollY: number) => {
      pad.current.rest(scrollY);
      fillPad();
    },
    [fillPad],
  );

  useEffect(() => {
    frames.current.clear();
    chasing.current = false;
    follow.current.reset();
    show(false);
    setCount(0);
    // a draft's first send moves its transcript to the new session's key: the lifted message stays lifted
    const kept = anchor.current;
    if (kept && latest.current.messages.at(-1)?.id === kept.id) follow.current.anchor();
    else {
      anchor.current = null;
      pad.current.release();
      applyPad();
    }
  }, [sessionKey, show, applyPad]);

  useEffect(schedule, [messages, schedule]);

  // commands the bottom of the last measured content; nothing until the viewport is measured
  const stickToBottom = useCallback((animated: boolean) => {
    const { viewport, content } = metrics.current;
    if (viewport === 0) return;
    const offset = Math.max(0, content - viewport);
    follow.current.commanded();
    // a plain step lands where it was told: record it now, because the scroll echo trails the next
    // streamed step, and a stale offset would read as "away" and turn every later step into a glide
    // that restarts each beat (the list visibly chasing the reply)
    if (!animated) metrics.current.scrollY = offset;
    listRef.current?.scrollToOffset({ offset, animated });
  }, []);

  // a message the reader just sent lands at the tail, appended to the thread already on screen
  useEffect(() => {
    const { id: previous, sessionKey: previousKey } = tail.current;
    tail.current.id = messages.at(-1)?.id ?? null;
    tail.current.sessionKey = sessionKey;
    const sent = sentMessage(messages, previous);
    if (sent !== null) {
      anchor.current = { id: sent, top: null, lifted: false };
      chasing.current = false;
      follow.current.anchor();
      show(false);
      return;
    }
    // a reload swapped the rows under a reader on the bottom: put them back there once the new rows are
    // laid out, since a reload that kept the height brings no content-size event to follow
    if (previousKey !== sessionKey || !replacedTail(messages, previous) || !follow.current.follows) return;
    cancelAnimationFrame(stepFrame.current);
    stepFrame.current = requestAnimationFrame(() => {
      stepFrame.current = 0;
      if (follow.current.follows) stickToBottom(false);
    });
  }, [messages, sessionKey, show, stickToBottom]);

  // scrolls the lifted message to the top once the padded content is tall enough to hold the offset
  const lift = useCallback(() => {
    const target = anchor.current;
    if (!target || target.top === null || target.lifted) return;
    const { viewport, content } = metrics.current;
    if (viewport === 0 || content < target.top + viewport - 1) return;
    target.lifted = true;
    follow.current.commanded();
    listRef.current?.scrollToOffset({ offset: target.top, animated: true });
  }, []);

  // a finished reply's lift ends where it rests (its glide may still be on the way there); a no-op until the
  // reply has ended, and once the lift has ended
  const endLift = useCallback(() => {
    const { scrollY, viewport, content } = metrics.current;
    const target = anchor.current;
    const y = target?.lifted && target.top !== null ? Math.max(scrollY, target.top) : scrollY;
    if (follow.current.replied(distanceFromBottom(y, viewport, content))) rested(y);
  }, [rested]);

  // The reply settled. Its settling commit may still grow the rows (the last text, the action bar): the content
  // size it reports was queued at that commit, so two frames on it has landed. Until then the lift holds and
  // follows nothing, so that growth never steps a reader resting on the lift.
  useEffect(() => {
    const was = wasRunning.current;
    wasRunning.current = running;
    if (!was || running) return;
    follow.current.replyEnded();
    cancelAnimationFrame(replyFrame.current);
    replyFrame.current = requestAnimationFrame(() => {
      replyFrame.current = requestAnimationFrame(() => {
        replyFrame.current = 0;
        endLift();
      });
    });
  }, [running, endLift]);

  // the sent message's cell measured: pad the content so its top can reach the viewport's top
  const place = useCallback(
    (id: string, y: number) => {
      const target = anchor.current;
      if (!target || target.id !== id || target.top !== null) return;
      target.top = Math.max(0, y - ANCHOR_GAP);
      pad.current.hold(target.top);
      applyPad();
      lift();
    },
    [applyPad, lift],
  );

  const onScroll = useCallback(
    (event: ScrollEvent) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      // against the previous echo, not a commanded offset the list has not reached yet
      const upward = contentOffset.y < echoY.current;
      echoY.current = contentOffset.y;
      metrics.current.scrollY = contentOffset.y;
      metrics.current.viewport = layoutMeasurement.height;
      metrics.current.content = contentSize.height;
      const distance = distanceOf(event);
      follow.current.scrolled(offsetOf(event));
      if (distance <= PINNED_DISTANCE) chasing.current = false;
      // Only the reader leaves the tail: programmatic follow never moves the list up.
      if (distance <= JUMP_SHOW_DISTANCE) show(false);
      else if ((upward || visibleRef.current) && !chasing.current) show(true);
      schedule();
    },
    [schedule, show],
  );

  const onDragStart = useCallback((event: ScrollEvent) => {
    cancelAnimationFrame(restFrame.current);
    restFrame.current = 0;
    chasing.current = false;
    follow.current.dragStart(offsetOf(event));
  }, []);
  // momentum, if any, starts in the same native pass as the release, so its event is in by the next frame;
  // until one of the two is seen nothing follows, or a step would take the fling from the reader
  const onDragEnd = useCallback(
    (event: ScrollEvent) => {
      follow.current.dragEnd(offsetOf(event));
      cancelAnimationFrame(restFrame.current);
      restFrame.current = requestAnimationFrame(() => {
        restFrame.current = 0;
        const { scrollY, viewport, content } = metrics.current;
        const y = clampOffset(scrollY, viewport, content);
        if (follow.current.rest(distanceFromBottom(scrollY, viewport, content), y)) rested(y);
      });
    },
    [rested],
  );
  const onFlingStart = useCallback(() => {
    cancelAnimationFrame(restFrame.current);
    restFrame.current = 0;
    follow.current.flingStart();
  }, []);
  const onFlingEnd = useCallback(
    (event: ScrollEvent) => {
      const y = offsetOf(event);
      if (follow.current.flingEnd(distanceOf(event), y)) rested(y);
    },
    [rested],
  );

  const onContentSize = useCallback(
    (_width: number, height: number) => {
      const { scrollY, viewport, content } = metrics.current;
      // a reader who let go a little above the bottom (or a pill chase) glides down; on the tail it is a plain step
      const away = chasing.current || distanceFromBottom(scrollY, viewport, content) > PINNED_DISTANCE;
      metrics.current.content = height;
      if (follow.current.follows) stickToBottom(away);
      else if (anchor.current && !anchor.current.lifted) lift();
      // a reader who stopped to read sees the reply grow away below them: the pill offers the way back
      else if (!chasing.current && distanceFromBottom(scrollY, viewport, height) > JUMP_SHOW_DISTANCE) show(true);
      schedule();
    },
    [lift, schedule, show, stickToBottom],
  );

  // a keyboard opening or closing resizes the viewport with no content-size event to follow it
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout;
      const previous = metrics.current.viewport;
      metrics.current.viewport = height;
      if (height === previous) return;
      if (pad.current.minHeight(height) !== null) {
        // the held offset keeps its room under a resized viewport
        fillPad();
        lift();
      } else if (previous > 0 && follow.current.follows) stickToBottom(false);
    },
    [fillPad, lift, stickToBottom],
  );

  const toBottom = useCallback(() => {
    chasing.current = true;
    follow.current.pin();
    follow.current.commanded();
    show(false);
    // padding the rows already fill below the reader drops, so the pill lands on the reply's own bottom
    rested(metrics.current.scrollY);
    listRef.current?.scrollToEnd({ animated: true });
  }, [rested, show]);

  // Cells are direct children of the scroll content, so their layout y shares the scroll offset's space.
  const Cell = useMemo(
    () =>
      function Cell({ item, onLayout, onFocusCapture, style, children }: CellRendererProps<ThreadMessage>) {
        const handleLayout = (event: LayoutChangeEvent) => {
          const { y, height } = event.nativeEvent.layout;
          frames.current.set(item.id, { y, height });
          onLayout?.(event);
          place(item.id, y);
          if (padHeight.current !== null && latest.current.messages.at(-1)?.id === item.id) fillPad();
          schedule();
        };
        // VirtualizedList's own cell hands View this untyped prop to track the focused cell.
        const focus = { onFocusCapture };
        return (
          <View {...focus} style={style} onLayout={handleLayout}>
            {children}
          </View>
        );
      },
    [place, fillPad, schedule],
  );

  return { listRef, Cell, visible, count, anchorMinHeight, onScroll, onDragStart, onDragEnd, onFlingStart, onFlingEnd, onContentSize, onLayout, toBottom };
}
