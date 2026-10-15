/**
 * A bot's face: its uploaded/generated image, its blobatar, or the static math
 * face, resolved the way the desktop's BotFace resolves it.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, SvgXml } from 'react-native-svg';
import { blobatar } from 'blobatar/blob';

import { faceGeometry, resolveLook } from './face.ts';
import type { BotMeta } from './roster.ts';

/** data URLs per profile, shared across rows; cleared when the roster says the avatar changed */
const imageCache = new Map<string, Promise<string | null>>();

export function forgetAvatar(name: string) {
  imageCache.delete(name);
}

type Props = {
  name: string;
  meta: BotMeta;
  hasAvatar: boolean;
  size: number;
  loadImage: (name: string) => Promise<string | null>;
};

function BotAvatarImpl({ name, meta, hasAvatar, size, loadImage }: Props) {
  const look = resolveLook(name, meta, hasAvatar);
  const [image, setImage] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (look.kind !== 'image') return;
    let live = true;
    let pending = imageCache.get(name);
    if (!pending) {
      pending = loadImage(name);
      imageCache.set(name, pending);
    }
    void pending.then((data) => {
      if (!live) return;
      if (data) setImage(data);
      else setImageFailed(true);
    });
    return () => {
      live = false;
    };
  }, [look.kind, name, loadImage]);

  const blobSeed = look.kind === 'blob' ? look.seed : null;
  const blobTrait = look.kind === 'blob' ? look.shapeTrait : undefined;
  const blobXml = useMemo(
    () =>
      blobSeed === null
        ? null
        : blobatar(blobSeed, { size, ...(blobTrait !== undefined ? { traits: { shape: blobTrait } } : {}) }),
    [blobSeed, blobTrait, size],
  );

  if (look.kind === 'image' && image && !imageFailed) {
    return <Image source={{ uri: image }} style={{ width: size, height: size, borderRadius: size * 0.22 }} />;
  }
  if (look.kind === 'image') {
    // while the asset loads (or if it is gone), the face the bot would otherwise wear
    return <BotAvatarImpl name={name} meta={meta} hasAvatar={false} size={size} loadImage={loadImage} />;
  }
  if (blobXml) return <SvgXml xml={blobXml} width={size} height={size} />;
  if (look.kind !== 'face') return <View style={{ width: size, height: size }} />;

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
