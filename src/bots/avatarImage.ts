/**
 * Getting a picture for an avatar: the device's photo library (desktop
 * `pickImageFromDevice`) and a generated image the gateway answered as a data URL
 * or a backend URL. Both go through the desktop's `normalizeAvatarImage`: the
 * centred square, scaled to 256 px, as a PNG data URL. Anything the asset store
 * would still refuse (the 2 MB guard, an unsupported type) is reported instead.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { imageToCacheFile } from '../chat/cards/shareImage.ts';
import { AVATAR_EDGE, avatarCrop, avatarImageError } from './look.ts';

export type Picked = { image: string } | { error: string } | null;

/** the image at `uri` as a 256 px square PNG data URL */
export async function normalizeAvatarImage(uri: string): Promise<string> {
  const source = await ImageManipulator.manipulate(uri).renderAsync();
  const result = await ImageManipulator.manipulate(source)
    .crop(avatarCrop(source.width, source.height))
    .resize({ width: AVATAR_EDGE, height: AVATAR_EDGE })
    .renderAsync();
  const saved = await result.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error('Could not read that image.');
  return `data:image/png;base64,${saved.base64}`;
}

/** the library's square crop; null when the user backs out */
export async function pickImageFromDevice(): Promise<Picked> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  let image: string;
  try {
    image = await normalizeAvatarImage(asset.uri);
  } catch {
    return { error: 'Could not read that image.' };
  }
  const error = avatarImageError(image);
  return error ? { error } : { image };
}

/** `image.generate` answers a data URL, or the backend's own URL when it could not inline it */
export async function normalizeGeneratedAvatar(image: string): Promise<string> {
  const file = await imageToCacheFile(image);
  try {
    return await normalizeAvatarImage(file.uri);
  } finally {
    try {
      new File(file.uri).delete();
    } catch {
      // the cache is trimmed anyway
    }
  }
}
