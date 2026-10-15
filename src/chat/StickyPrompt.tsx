/**
 * The sticky prompt: a user message pinned at the top of the transcript while the
 * rest of its turn scrolls beneath, as a view laid over assistant-ui's list - not
 * `stickyHeaderIndices`, which crashes Android's FlatList (RN #53258), and not a
 * replacement for the list, whose stick-to-bottom is untouched. The hook only
 * listens to the scroll and the row frames the jump-to-bottom pill already
 * measures; where the prompt sits is arithmetic in stickyPrompt.ts.
 *
 * Clamped to four lines with a soft fade, tap to open (so it is not selectable
 * until opened: `selectable` with a line clamp is broken on Android, RN #48921),
 * and painted over a chat-surface band, where the desktop clips what it covers
 * instead (a recorded parity deviation). It steps aside while the keyboard is up.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { useTokens } from '../ui/tokens.ts';
import type { RowFrame } from './scroll.ts';
import { pinnedPrompt, pinOffset, STICKY_CLAMP_LINES, STICKY_TOP, type StickyPin, type StickyRow } from './stickyPrompt.ts';
import type { Message } from './transcript.ts';

/** a transcript row's vertical padding, so the bubble sits this far below its cell's top */
export const ROW_PAD = 6;
/** the band's inset: the transcript's side padding, so the pinned bubble lines up with the one it replaces */
const SIDE_INSET = 24;
/** desktop `--conversation-turn-gap`, 0.375rem: the band's breathing room below the bubble */
const TURN_GAP = 6;

export type StickyPrompt = {
  /** the pinned message's id, or null */
  pinId: string | null;
  /** how far the next turn has pushed the bubble up, in dp (0 or negative) */
  offset: SharedValue<number>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSize: (height: number) => void;
  /** the band's measured height, including its top inset and turn gap */
  onBand: (height: number) => void;
};

export function useStickyPrompt(sessionKey: string, messages: readonly Message[], frames: RefObject<Map<string, RowFrame>>): StickyPrompt {
  const scrollY = useRef(0);
  const contentBottom = useRef(0);
  const bubble = useRef(0);
  const [pinId, setPinId] = useState<string | null>(null);
  const offset = useSharedValue(0);
  const rows = useRef<StickyRow[]>([]);
  rows.current = useMemo(() => messages.map((m) => ({ id: m.id, role: m.role })), [messages]);

  const evaluate = useCallback(() => {
    const pin: StickyPin | null = pinnedPrompt(rows.current, frames.current, scrollY.current, ROW_PAD, contentBottom.current);
    const next = pin ? pin.id : null;
    setPinId((current) => (current === next ? current : next));
    offset.value = pin ? pinOffset(pin, scrollY.current, bubble.current) : 0;
  }, [frames, offset]);

  useEffect(() => {
    scrollY.current = 0;
    contentBottom.current = 0;
    setPinId(null);
    offset.value = 0;
  }, [sessionKey, offset]);

  useEffect(evaluate, [messages, evaluate]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = event.nativeEvent.contentOffset.y;
      evaluate();
    },
    [evaluate],
  );
  const onContentSize = useCallback(
    (height: number) => {
      contentBottom.current = height;
      evaluate();
    },
    [evaluate],
  );
  const onBand = useCallback(
    (height: number) => {
      bubble.current = Math.max(0, height - STICKY_TOP);
      evaluate();
    },
    [evaluate],
  );

  return { pinId, offset, onScroll, onContentSize, onBand };
}

export function StickyPrompt({ sticky, messages }: { sticky: StickyPrompt; messages: readonly Message[] }) {
  const t = useTokens();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState(0);
  const [band, setBand] = useState(0);
  const { offset } = sticky;
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  useEffect(() => {
    setExpanded(false);
    setFull(0);
  }, [sticky.pinId]);

  const message = sticky.pinId ? messages.find((m) => m.id === sticky.pinId) : undefined;
  if (!message || keyboardVisible) return null;

  const text = message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n');
  // desktop `.sticky-human-clamp`: four lines of 1.3 leading, plus a sliver
  const clamp = STICKY_CLAMP_LINES * t.type.lineHeight + 2.4;
  const clamped = !expanded && full > clamp + 1;
  const onBandLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height !== band) {
      setBand(height);
      sticky.onBand(height);
    }
  };
  const bubbleColor = t.uiChatBubbleBackground;
  const clear = `${bubbleColor.slice(0, 7)}00`;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Animated.View
        onLayout={onBandLayout}
        style={[styles.band, { backgroundColor: t.uiChatSurfaceBackground, paddingTop: STICKY_TOP, paddingBottom: TURN_GAP }, slide]}
        pointerEvents="box-none"
      >
        <View style={styles.userRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse the pinned prompt' : 'Expand the pinned prompt'}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((open) => !open)}
            style={[styles.bubble, { backgroundColor: bubbleColor, borderRadius: t.radius['3xl'] }]}
          >
            <View style={!expanded ? { maxHeight: clamp, overflow: 'hidden' } : undefined}>
              <View onLayout={(event) => setFull(event.nativeEvent.layout.height)}>
                <Text selectable={expanded} style={{ color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight }}>
                  {text}
                </Text>
              </View>
              {clamped ? <LinearGradient pointerEvents="none" colors={[clear, bubbleColor]} style={[styles.fade, { height: clamp * 0.45 }]} /> : null}
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // clips the band as the next turn carries it off the top, so it never paints over the app bar
  layer: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  band: { paddingHorizontal: SIDE_INSET },
  userRow: { alignItems: 'flex-end', paddingLeft: 48 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
