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
 * offset exists); nothing follows the reply until the reader scrolls. The pill
 * shows once the reader is away from the bottom, counts rows below the fold
 * from the cells' own layouts, and on a tap chases the tail until the list
 * re-pins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type CellRendererProps, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ThreadMessage } from '@assistant-ui/react-native';

import { distanceFromBottom, JUMP_SHOW_DISTANCE, messagesBelow, PINNED_DISTANCE, sentMessage, TailFollow, type RowFrame } from './scroll.ts';
import type { Message } from './transcript.ts';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

const distanceOf = ({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }: ScrollEvent) =>
  distanceFromBottom(contentOffset.y, layoutMeasurement.height, contentSize.height);
const offsetOf = (event: ScrollEvent) => event.nativeEvent.contentOffset.y;

/** the room left above the reader's own message when a send lifts it to the top */
const ANCHOR_GAP = 12;

type Anchor = { id: string; top: number | null; lifted: boolean };

export function useJumpToBottom(sessionKey: string, messages: readonly Message[]) {
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
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);
  // the message a send lifted to the top, and the content offset it is lifted to
  const anchor = useRef<Anchor | null>(null);
  const [anchorMinHeight, setAnchorMinHeight] = useState<number | null>(null);
  const tail = useRef(messages.at(-1)?.id ?? null);

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

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

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
      setAnchorMinHeight(null);
    }
  }, [sessionKey, show]);

  useEffect(schedule, [messages, schedule]);

  // a message the reader just sent lands at the tail, appended to the thread already on screen
  useEffect(() => {
    const previous = tail.current;
    tail.current = messages.at(-1)?.id ?? null;
    const sent = sentMessage(messages, previous);
    if (sent === null) return;
    anchor.current = { id: sent, top: null, lifted: false };
    chasing.current = false;
    follow.current.anchor();
    show(false);
  }, [messages, show]);

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

  // the sent message's cell measured: pad the content so its top can reach the viewport's top
  const place = useCallback(
    (id: string, y: number) => {
      const target = anchor.current;
      if (!target || target.id !== id || target.top !== null) return;
      target.top = Math.max(0, y - ANCHOR_GAP);
      const { viewport } = metrics.current;
      if (viewport > 0) setAnchorMinHeight(target.top + viewport);
      lift();
    },
    [lift],
  );

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
      follow.current.scrolled(distance);
      if (distance <= PINNED_DISTANCE) chasing.current = false;
      // Only the reader leaves the tail: programmatic follow never moves the list up.
      if (distance <= JUMP_SHOW_DISTANCE) show(false);
      else if ((upward || visibleRef.current) && !chasing.current) show(true);
      schedule();
    },
    [schedule, show],
  );

  const onDragStart = useCallback((event: ScrollEvent) => {
    chasing.current = false;
    follow.current.dragStart(offsetOf(event));
  }, []);
  const onDragEnd = useCallback((event: ScrollEvent) => follow.current.dragEnd(distanceOf(event), offsetOf(event)), []);
  const onFlingStart = useCallback(() => follow.current.flingStart(), []);
  const onFlingEnd = useCallback((event: ScrollEvent) => follow.current.flingEnd(distanceOf(event), offsetOf(event)), []);

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
      const top = anchor.current?.top ?? null;
      if (top !== null) {
        // the lifted message keeps its room under a resized viewport
        setAnchorMinHeight(top + height);
        lift();
      } else if (previous > 0 && follow.current.follows) stickToBottom(false);
    },
    [lift, stickToBottom],
  );

  const toBottom = useCallback(() => {
    chasing.current = true;
    follow.current.pin();
    follow.current.commanded();
    show(false);
    listRef.current?.scrollToEnd({ animated: true });
  }, [show]);

  // Cells are direct children of the scroll content, so their layout y shares the scroll offset's space.
  const Cell = useMemo(
    () =>
      function Cell({ item, onLayout, onFocusCapture, style, children }: CellRendererProps<ThreadMessage>) {
        const handleLayout = (event: LayoutChangeEvent) => {
          const { y, height } = event.nativeEvent.layout;
          frames.current.set(item.id, { y, height });
          onLayout?.(event);
          place(item.id, y);
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
    [place, schedule],
  );

  return { listRef, Cell, visible, count, anchorMinHeight, onScroll, onDragStart, onDragEnd, onFlingStart, onFlingEnd, onContentSize, onLayout, toBottom };
}
