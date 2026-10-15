/**
 * The image lightbox: a pushed full-screen route (not a modal) holding one or a
 * set of images. Pinch and drag move the picture; the bottom pill carries the
 * desktop's zoom controls (0.25-8x, 1.25 steps, a percentage that resets); a
 * clean tap closes it, as the desktop's clean click does. The top bar has the
 * share action, whose sheet is how a phone saves a picture. Without
 * react-native-gesture-handler in the app the gestures run on RN's
 * PanResponder, writing straight into Reanimated shared values.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlay } from '../app/overlay.tsx';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { useTokens } from '../ui/tokens.ts';
import { shareImage } from './cards/shareImage.ts';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';

export type LightboxImage = { src: string; alt?: string };

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const BUTTON_STEP = 1.25;
const SWIPE_PX = 80;
const TAP_PX = 4;
const TAP_MS = 500;

const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

type Gesture = {
  mode: 'pan' | 'pinch';
  startedAt: number;
  moved: boolean;
  dist0: number;
  scale0: number;
  x0: number;
  y0: number;
  midX0: number;
  midY0: number;
};

export function useOpenLightbox() {
  const overlay = useOverlay();
  return useCallback(
    (images: LightboxImage[], index = 0) => {
      overlay.push('lightbox', (close) => <Lightbox images={images} index={index} onClose={close} />);
    },
    [overlay],
  );
}

export function Lightbox({ images, index: initial = 0, onClose }: { images: LightboxImage[]; index?: number; onClose: () => void }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(Math.min(Math.max(initial, 0), images.length - 1));
  const [percent, setPercent] = useState(100);
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const base = useRef({ scale: 1, x: 0, y: 0 });
  const stage = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const live = useRef<Gesture | null>(null);
  const paged = images.length > 1;

  const apply = useCallback((nextScale: number, nextX: number, nextY: number) => {
    base.current = { scale: nextScale, x: nextX, y: nextY };
    scale.value = nextScale;
    x.value = nextX;
    y.value = nextY;
    setPercent(Math.round(nextScale * 100));
  }, [scale, x, y]);

  const zoomBy = useCallback((factor: number) => {
    const b = base.current;
    const next = clamp(b.scale * factor);
    const k = next / b.scale;
    apply(next, k * b.x, k * b.y);
  }, [apply]);

  const go = useCallback((step: number) => {
    apply(1, 0, 0);
    setIndex((value) => (value + step + images.length) % images.length);
  }, [apply, images.length]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          live.current = { mode: 'pan', startedAt: Date.now(), moved: false, dist0: 0, scale0: 1, x0: 0, y0: 0, midX0: 0, midY0: 0 };
        },
        onPanResponderMove: (event, gesture) => {
          const g = live.current;
          if (!g) return;
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            const [a, b] = touches;
            const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            const midX = (a.pageX + b.pageX) / 2;
            const midY = (a.pageY + b.pageY) / 2;
            if (g.mode !== 'pinch') {
              Object.assign(g, { mode: 'pinch', dist0: dist, scale0: base.current.scale, x0: base.current.x, y0: base.current.y, midX0: midX, midY0: midY });
            }
            g.moved = true;
            const next = clamp((g.scale0 * dist) / (g.dist0 || 1));
            const k = next / g.scale0;
            // the zoom holds the point between the fingers still, measured from the stage centre
            const cx = g.midX0 - origin.current.x - size.width / 2;
            const cy = g.midY0 - origin.current.y - size.height / 2;
            scale.value = next;
            x.value = cx - k * (cx - g.x0) + (midX - g.midX0);
            y.value = cy - k * (cy - g.y0) + (midY - g.midY0);
            return;
          }
          if (g.mode !== 'pan') return;
          if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > TAP_PX) g.moved = true;
          if (base.current.scale > 1) {
            x.value = base.current.x + gesture.dx;
            y.value = base.current.y + gesture.dy;
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          const g = live.current;
          live.current = null;
          if (!g) return;
          if (g.mode === 'pinch') {
            apply(scale.value, x.value, y.value);
            return;
          }
          if (!g.moved && Date.now() - g.startedAt < TAP_MS) {
            onClose();
            return;
          }
          if (base.current.scale > 1) {
            apply(base.current.scale, x.value, y.value);
          } else if (paged && Math.abs(gesture.dx) > SWIPE_PX && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) {
            go(gesture.dx < 0 ? 1 : -1);
          }
        },
        onPanResponderTerminate: () => {
          live.current = null;
          apply(base.current.scale, base.current.x, base.current.y);
        },
      }),
    [apply, go, onClose, paged, scale, size.height, size.width, x, y],
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  const current = images[index];
  const save = async () => {
    if (saving || !current) return;
    setSaving(true);
    try {
      await shareImage(current.src);
    } catch {
      // a dismissed sheet and a failed write both leave the picture where it was
    } finally {
      setSaving(false);
    }
  };

  const pill = { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary };

  return (
    <View style={styles.root}>
      <View
        ref={stage}
        style={StyleSheet.absoluteFill}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize({ width, height });
          stage.current?.measureInWindow((wx, wy) => {
            origin.current = { x: wx, y: wy };
          });
        }}
        {...responder.panHandlers}
      >
        <Animated.View style={[styles.fill, imageStyle]} pointerEvents="none">
          {current && size.width > 0 ? (
            <Image
              source={{ uri: current.src }}
              resizeMode="contain"
              accessibilityLabel={current.alt || 'Image'}
              style={{ width: size.width, height: size.height }}
            />
          ) : null}
        </Animated.View>
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <RoundButton name="close" label="Close" onPress={onClose} style={pill} color={t.uiTextSecondary} />
        <View style={styles.spacer} />
        {saving ? (
          <View style={[styles.round, pill]}>
            <GlyphSpinner size={14} color={t.uiTextSecondary} />
          </View>
        ) : (
          <RoundButton name="share" label="Save image" onPress={() => void save()} style={pill} color={t.uiTextSecondary} />
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {paged ? (
          <Text style={[styles.count, { color: t.uiTextSecondary, fontSize: t.type.tool }]}>
            {index + 1} / {images.length}
          </Text>
        ) : null}
        <View style={[styles.pill, pill, { borderRadius: t.radius.full }]}>
          {paged ? <RoundButton name="chevron-left" label="Previous image" onPress={() => go(-1)} color={t.uiTextSecondary} small /> : null}
          <RoundButton name="zoom-out" label="Zoom out" onPress={() => zoomBy(1 / BUTTON_STEP)} color={t.uiTextSecondary} disabled={percent <= MIN_SCALE * 100} small />
          <Pressable
            onPress={() => apply(1, 0, 0)}
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            style={styles.percent}
          >
            <Text style={{ color: t.uiTextSecondary, fontSize: t.type.caption, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{percent}%</Text>
          </Pressable>
          <RoundButton name="zoom-in" label="Zoom in" onPress={() => zoomBy(BUTTON_STEP)} color={t.uiTextSecondary} disabled={percent >= MAX_SCALE * 100} small />
          {paged ? <RoundButton name="chevron-right" label="Next image" onPress={() => go(1)} color={t.uiTextSecondary} small /> : null}
        </View>
      </View>
    </View>
  );
}

function RoundButton({
  name,
  label,
  onPress,
  color,
  style,
  disabled,
  small,
}: {
  name: CodiconName;
  label: string;
  onPress: () => void;
  color: string;
  style?: object;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={small ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[small ? styles.small : styles.round, style, disabled && { opacity: 0.4 }]}
    >
      <Codicon name={name} size={small ? 16 : 18} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  small: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 8 },
  count: { fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4, borderWidth: StyleSheet.hairlineWidth },
  percent: { minWidth: 56, height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
