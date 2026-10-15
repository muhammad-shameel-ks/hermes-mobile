/**
 * Drives the jump-to-bottom pill from the transcript's FlatList. assistant-ui
 * keeps owning stick-to-bottom; this only watches: it shows the pill once the
 * reader scrolls up past the threshold, counts rows below the fold from the
 * cells' own layouts, and on a tap chases the tail until the list re-pins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type CellRendererProps, type FlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ThreadMessage } from '@assistant-ui/react-native';

import { distanceFromBottom, JUMP_SHOW_DISTANCE, messagesBelow, type RowFrame } from './scroll.ts';
import type { Message } from './transcript.ts';

/** within this of the edge the list is back on the tail */
const PINNED_DISTANCE = 4;

export function useJumpToBottom(sessionKey: string, messages: readonly Message[]) {
  const listRef = useRef<FlatList<ThreadMessage>>(null);
  const frames = useRef(new Map<string, RowFrame>());
  const metrics = useRef({ scrollY: 0, viewport: 0 });
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
    show(false);
    setCount(0);
  }, [sessionKey, show]);

  useEffect(schedule, [messages, schedule]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const upward = contentOffset.y < metrics.current.scrollY;
      metrics.current.scrollY = contentOffset.y;
      metrics.current.viewport = layoutMeasurement.height;
      const distance = distanceFromBottom(contentOffset.y, layoutMeasurement.height, contentSize.height);
      if (distance <= PINNED_DISTANCE) chasing.current = false;
      // Only the reader leaves the tail: programmatic follow never moves the list up.
      if (distance <= JUMP_SHOW_DISTANCE) show(false);
      else if ((upward || visibleRef.current) && !chasing.current) show(true);
      schedule();
    },
    [schedule, show],
  );

  const onDrag = useCallback(() => {
    chasing.current = false;
  }, []);

  const onContentSize = useCallback(() => {
    if (chasing.current) listRef.current?.scrollToEnd({ animated: true });
    else schedule();
  }, [schedule]);

  const toBottom = useCallback(() => {
    chasing.current = true;
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

  return { listRef, Cell, visible, count, onScroll, onDrag, onContentSize, toBottom };
}
