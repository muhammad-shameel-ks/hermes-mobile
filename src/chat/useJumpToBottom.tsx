/**
 * The transcript's FlatList scroll behaviour: following a streaming reply, and
 * the jump-to-bottom pill. assistant-ui still places the list on the bottom when
 * a thread opens, a run starts or the thread switches; following growing content
 * is ours (`TailFollow`), because assistant-ui's follow reads a pinned flag that
 * only a scroll echo refreshes, so a token landing as the reader starts to drag
 * pulls them back down. The pill shows once the reader scrolls up past the
 * threshold, counts rows below the fold from the cells' own layouts, and on a
 * tap chases the tail until the list re-pins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type CellRendererProps, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ThreadMessage } from '@assistant-ui/react-native';

import { distanceFromBottom, JUMP_SHOW_DISTANCE, messagesBelow, PINNED_DISTANCE, TailFollow, type RowFrame } from './scroll.ts';
import type { Message } from './transcript.ts';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

const distanceOf = ({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }: ScrollEvent) =>
  distanceFromBottom(contentOffset.y, layoutMeasurement.height, contentSize.height);

export function useJumpToBottom(sessionKey: string, messages: readonly Message[]) {
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const frames = useRef(new Map<string, RowFrame>());
  const metrics = useRef({ scrollY: 0, viewport: 0, content: 0 });
  const follow = useRef(new TailFollow());
  // the ids are only read while the pill shows, so a streamed token never maps the whole thread
  const latest = useRef({ messages, ids: null as string[] | null });
  if (latest.current.messages !== messages) latest.current = { messages, ids: null };
  const chasing = useRef(false);
  const visibleRef = useRef(false);
  const frame = useRef(0);
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);

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
  }, [sessionKey, show]);

  useEffect(schedule, [messages, schedule]);

  // commands the bottom of the last measured content; nothing until the viewport is measured
  const stickToBottom = useCallback((animated: boolean) => {
    const { viewport, content } = metrics.current;
    if (viewport === 0) return;
    follow.current.commanded();
    listRef.current?.scrollToOffset({ offset: Math.max(0, content - viewport), animated });
  }, []);

  const onScroll = useCallback(
    (event: ScrollEvent) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const upward = contentOffset.y < metrics.current.scrollY;
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

  const onDragStart = useCallback(() => {
    chasing.current = false;
    follow.current.dragStart();
  }, []);
  const onDragEnd = useCallback((event: ScrollEvent) => follow.current.dragEnd(distanceOf(event)), []);
  const onFlingStart = useCallback(() => follow.current.flingStart(), []);
  const onFlingEnd = useCallback((event: ScrollEvent) => follow.current.flingEnd(distanceOf(event)), []);

  const onContentSize = useCallback(
    (_width: number, height: number) => {
      const { scrollY, viewport, content } = metrics.current;
      // a reader who let go a little above the bottom (or a pill chase) glides down; on the tail it is a plain step
      const away = chasing.current || distanceFromBottom(scrollY, viewport, content) > PINNED_DISTANCE;
      metrics.current.content = height;
      if (follow.current.follows) stickToBottom(away);
      schedule();
    },
    [schedule, stickToBottom],
  );

  // a keyboard opening or closing resizes the viewport with no content-size event to follow it
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout;
      const previous = metrics.current.viewport;
      metrics.current.viewport = height;
      if (previous > 0 && height !== previous && follow.current.follows) stickToBottom(false);
    },
    [stickToBottom],
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
    [schedule],
  );

  return { listRef, Cell, visible, count, onScroll, onDragStart, onDragEnd, onFlingStart, onFlingEnd, onContentSize, onLayout, toBottom };
}
