/**
 * A bot's face: its uploaded/generated image, its blobatar, or the math face
 * (animated by the face clock), resolved the way the desktop's BotFace resolves
 * it.
 */

import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Image, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path, SvgXml } from 'react-native-svg';
import { blobatar } from 'blobatar/blob';

import { AnimatedFace } from './AnimatedFace.tsx';
import { faceGeometry, resolveLook, type FaceMood } from './face.ts';
import { isBackfilledFacePng } from './look.ts';
import type { BotMeta } from './roster.ts';

/** data URLs per profile, shared across rows; cleared when the roster says the avatar changed */
const imageCache = new Map<string, Promise<string | null>>();
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();

function bump(name: string) {
  revisions.set(name, (revisions.get(name) ?? 0) + 1);
  for (const listener of listeners) listener();
}

export function forgetAvatar(name: string) {
  imageCache.delete(name);
  bump(name);
}

/** a just-saved image shows at once instead of waiting for a fetch */
export function primeAvatar(name: string, dataUrl: string | null) {
  imageCache.set(name, Promise.resolve(dataUrl));
  bump(name);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type Props = {
  name: string;
  meta: BotMeta;
  hasAvatar: boolean;
  size: number;
  loadImage: (name: string) => Promise<string | null>;
  mood?: FaceMood;
  /** a draft's picture (null for none) instead of the stored one, as the avatar editor previews it */
  image?: string | null;
};

function BotAvatarImpl({ name, meta, hasAvatar, size, loadImage, mood = 'idle', image: draft }: Props) {
  const reduced = useReducedMotion();
  const revision = useSyncExternalStore(subscribe, () => revisions.get(name) ?? 0);
  const [loaded, setLoaded] = useState<{ name: string; data: string | null } | null>(null);
  const fetches = draft === undefined && hasAvatar;

  useEffect(() => {
    if (!fetches) return;
    let live = true;
    let pending = imageCache.get(name);
    if (!pending) {
      pending = loadImage(name);
      imageCache.set(name, pending);
    }
    void pending.then((data) => {
      if (live) setLoaded({ name, data });
    });
    return () => {
      live = false;
    };
  }, [fetches, name, loadImage, revision]);

  // the desktop backfills a 160x160 face-copy PNG; that is not a picture, and the live face can animate
  const picture = draft !== undefined ? draft : fetches && loaded?.name === name ? loaded.data : null;
  const photo = picture && !isBackfilledFacePng(picture) ? picture : null;

  // while a stored image loads (or if it is gone), the face the bot would otherwise wear
  const look = resolveLook(name, meta, false);
  const blobSeed = look.kind === 'blob' ? look.seed : null;
  const blobTrait = look.kind === 'blob' ? look.shapeTrait : undefined;
  const blobXml = useMemo(
    () =>
      blobSeed === null
        ? null
        : blobatar(blobSeed, { size, ...(blobTrait !== undefined ? { traits: { shape: blobTrait } } : {}) }),
    [blobSeed, blobTrait, size],
  );

  if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size * 0.22 }} />;
  if (blobXml) return <SvgXml xml={blobXml} width={size} height={size} />;
  if (look.kind !== 'face') return <View style={{ width: size, height: size }} />;
  if (!reduced) return <AnimatedFace key={look.shape} shape={look.shape} color={look.color} mood={mood} size={size} />;

  const face = faceGeometry(look.shape, look.color);
  const y = face.eyeY;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 44">
      <Path d={face.body} fill={look.color} />
      <Ellipse cx={15.4} cy={y} rx={2.2} ry={2.3} fill={face.eyeFill} />
      <Ellipse cx={24.6} cy={y} rx={2.2} ry={2.3} fill={face.eyeFill} />
      <Circle cx={14.8} cy={y - 0.7} r={0.65} fill={face.highlightFill} />
      <Circle cx={24} cy={y - 0.7} r={0.65} fill={face.highlightFill} />
    </Svg>
  );
}

export const BotAvatar = memo(BotAvatarImpl);
