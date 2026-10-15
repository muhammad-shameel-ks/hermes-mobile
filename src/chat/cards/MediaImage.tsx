/**
 * An image in the transcript: a markdown image, a `MEDIA:` delivery, a tool
 * row's output or a generated image. It reserves its frame before the bytes
 * arrive (the known pixel size, else a 4:3 envelope every shape fits), keeps its
 * natural size without upscaling, and opens the lightbox on tap. A source that
 * cannot load collapses to one line rather than an empty frame.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View, type ImageLoadEventData, type NativeSyntheticEvent } from 'react-native';

import { useTokens } from '../../ui/tokens.ts';
import { useOpenLightbox } from '../Lightbox.tsx';
import { isInlineMediaSrc, mediaKind, mediaName } from '../media.ts';
import { copyText } from '../../ui/clipboard.ts';
import { SvgBlock } from './SvgBlock.tsx';
import { useImageSource } from './useMedia.ts';

/** desktop COLD_IMAGE_RATIO: the envelope an image can occupy, so no shape shrinks to fit a 16:9 box */
const COLD_RATIO = 4 / 3;
/** the smallest of desktop `--image-preview-height`'s clamp, a phone being shorter than its upper bounds */
const MAX_HEIGHT = 420;

export type ImageDims = { width: number; height: number };

// geometry only, never the bytes: a miss costs a letterboxed first paint, not a collapsed row
const dimsCache = new Map<string, ImageDims | 'broken'>();
const DIMS_CACHE_SIZE = 512;

function remember(key: string, value: ImageDims | 'broken') {
  dimsCache.delete(key);
  dimsCache.set(key, value);
  if (dimsCache.size > DIMS_CACHE_SIZE) dimsCache.delete(dimsCache.keys().next().value as string);
}

function MediaImageImpl({
  src,
  alt,
  dims,
  hintRatio = COLD_RATIO,
  radius,
  maxHeight = MAX_HEIGHT,
}: {
  src: string;
  alt?: string;
  /** the decoded size, when the source reported it */
  dims?: ImageDims;
  hintRatio?: number;
  radius?: number;
  maxHeight?: number;
}) {
  const t = useTokens();
  const openLightbox = useOpenLightbox();
  const source = useImageSource(src);
  const [available, setAvailable] = useState(0);
  const [, bump] = useState(0);
  const name = mediaName(src || alt || 'image');
  const known = dims ?? (dimsCache.get(src) !== 'broken' ? (dimsCache.get(src) as ImageDims | undefined) : undefined);
  const broken = dimsCache.get(src) === 'broken';
  const corner = radius ?? t.radius.lg;

  const onLoad = useCallback(
    (event: NativeSyntheticEvent<ImageLoadEventData>) => {
      const { width, height } = event.nativeEvent.source;
      if (width > 0 && height > 0 && !dimsCache.has(src)) {
        remember(src, { width, height });
        bump((value) => value + 1);
      }
    },
    [src],
  );

  if (!src) return null;

  if (source.status === 'failed' || broken) {
    const local = !isInlineMediaSrc(src);
    return (
      <Text style={[styles.line, { color: t.uiTextTertiary, fontSize: t.type.caption }]}>
        {`Couldn’t load ${name}. `}
        <Text
          accessibilityRole="button"
          style={{ color: t.uiTextPrimary, fontWeight: '500' }}
          onPress={() => (local ? void copyText(src) : void Linking.openURL(src).catch(() => {}))}
        >
          {local ? 'Copy path' : 'Open image'}
        </Text>
      </Text>
    );
  }

  const svg = mediaKind(src) === 'image' && /\.svg(?:[?#]|$)/i.test(src);
  const ratio = known ? known.width / known.height : hintRatio;
  // never upscaled, never taller than the cap, never wider than the column
  const natural = known?.width ?? Infinity;
  const width = Math.min(available || 0, natural, maxHeight * ratio);
  const height = width / ratio;

  return (
    <View style={styles.wrap} onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
      {svg && source.status === 'ready' ? (
        <SvgFromSource uri={source.value} />
      ) : available > 0 ? (
        <Pressable
          disabled={source.status !== 'ready'}
          onPress={() => source.status === 'ready' && openLightbox([{ src: source.value, alt: alt || name }])}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Open image: ${alt || name}`}
          style={{ width, height, borderRadius: corner, overflow: 'hidden', backgroundColor: t.uiBgTertiary }}
        >
          {source.status === 'ready' ? (
            <Image
              source={{ uri: source.value }}
              resizeMode="contain"
              accessibilityLabel={alt || name}
              style={{ width, height }}
              onLoad={onLoad}
              onError={() => {
                remember(src, 'broken');
                bump((value) => value + 1);
              }}
            />
          ) : (
            <View style={styles.pending}>
              <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>
                {`Loading ${name}…`}
              </Text>
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function SvgFromSource({ uri }: { uri: string }) {
  const [xml, setXml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const data = /^data:image\/svg\+xml(;base64)?,([\s\S]*)$/i.exec(uri);
    if (data) {
      try {
        setXml(data[1] ? atob(data[2]) : decodeURIComponent(data[2]));
      } catch {
        setXml('');
      }
    } else {
      fetch(uri)
        .then((response) => response.text())
        .then(
          (text) => !cancelled && setXml(text),
          () => !cancelled && setXml(''),
        );
    }
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return xml ? <SvgBlock xml={xml} /> : null;
}

export const MediaImage = memo(MediaImageImpl);

const styles = StyleSheet.create({
  wrap: { width: '100%', marginVertical: 8, alignItems: 'flex-start' },
  pending: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  line: { marginVertical: 8 },
});
