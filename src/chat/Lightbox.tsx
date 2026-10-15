/**
 * The image lightbox: a pushed full-screen route (not a modal) holding one or a
 * set of images. Pinch, drag and double tap move the picture (ZoomableImage);
 * the bottom pill carries the desktop's zoom controls (0.25-8x, 1.25 steps, a
 * percentage that resets); a clean tap closes it, as the desktop's clean click
 * does. The top bar saves the picture to the photo library and, separately,
 * hands it to the share sheet.
 */

import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlay } from '../app/overlay.tsx';
import { useToast } from '../files/ui.tsx';
import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { useTokens } from '../ui/tokens.ts';
import { ZoomableImage, type ZoomHandle } from '../ui/ZoomableImage.tsx';
import { BUTTON_STEP, MAX_SCALE, MIN_SCALE } from '../ui/zoom.ts';
import { saveImageToLibrary } from './cards/saveImage.ts';
import { shareImage } from './cards/shareImage.ts';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';

export type LightboxImage = { src: string; alt?: string };

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
  const paged = images.length > 1;
  const toast = useToast(paged ? 96 : 72);
  const [index, setIndex] = useState(Math.min(Math.max(initial, 0), images.length - 1));
  const [percent, setPercent] = useState(100);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const zoom = useRef<ZoomHandle>(null);

  const go = useCallback((step: number) => {
    setPercent(100);
    setIndex((value) => (value + step + images.length) % images.length);
  }, [images.length]);

  const current = images[index];
  const run = async (kind: 'save' | 'share') => {
    if (busy || !current) return;
    setBusy(kind);
    try {
      if (kind === 'save') {
        const notice = await saveImageToLibrary(current.src);
        toast.show(notice.text, notice.tone);
      } else {
        await shareImage(current.src);
      }
    } catch {
      // a dismissed sheet and a failed write both leave the picture where it was
    } finally {
      setBusy(null);
    }
  };

  const pill = { backgroundColor: t.uiBgElevated, borderColor: t.uiStrokeSecondary };
  const action = (kind: 'save' | 'share', icon: CodiconName, label: string) =>
    busy === kind ? (
      <View style={[styles.round, pill]}>
        <GlyphSpinner size={14} color={t.uiTextSecondary} />
      </View>
    ) : (
      <RoundButton name={icon} label={label} onPress={() => void run(kind)} style={pill} color={t.uiTextSecondary} />
    );

  return (
    <View style={styles.root}>
      {current ? (
        <ZoomableImage
          key={index}
          ref={zoom}
          uri={current.src}
          alt={current.alt}
          onTap={onClose}
          onSwipe={paged ? go : undefined}
          onScale={(scale) => setPercent(Math.round(scale * 100))}
        />
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <RoundButton name="close" label="Close" onPress={onClose} style={pill} color={t.uiTextSecondary} />
        <View style={styles.spacer} />
        {action('save', 'download', 'Save to Photos')}
        {action('share', 'share', 'Share image')}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {paged ? (
          <Text style={[styles.count, { color: t.uiTextSecondary, fontSize: t.type.tool }]}>
            {index + 1} / {images.length}
          </Text>
        ) : null}
        <View style={[styles.pill, pill, { borderRadius: t.radius.full }]}>
          {paged ? <RoundButton name="chevron-left" label="Previous image" onPress={() => go(-1)} color={t.uiTextSecondary} small /> : null}
          <RoundButton name="zoom-out" label="Zoom out" onPress={() => zoom.current?.zoomBy(1 / BUTTON_STEP)} color={t.uiTextSecondary} disabled={percent <= MIN_SCALE * 100} small />
          <Pressable
            onPress={() => zoom.current?.reset()}
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            style={styles.percent}
          >
            <Text style={{ color: t.uiTextSecondary, fontSize: t.type.caption, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{percent}%</Text>
          </Pressable>
          <RoundButton name="zoom-in" label="Zoom in" onPress={() => zoom.current?.zoomBy(BUTTON_STEP)} color={t.uiTextSecondary} disabled={percent >= MAX_SCALE * 100} small />
          {paged ? <RoundButton name="chevron-right" label="Next image" onPress={() => go(1)} color={t.uiTextSecondary} small /> : null}
        </View>
      </View>
      {toast.node}
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
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  small: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 8 },
  count: { fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4, borderWidth: StyleSheet.hairlineWidth },
  percent: { minWidth: 56, height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
