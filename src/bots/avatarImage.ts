/**
 * Getting a picture for an avatar: the device's photo library (desktop
 * `pickImageFromDevice`) and a generated image the gateway could only hand back as
 * a URL. The desktop downsizes everything to a 256 px square PNG on a canvas; the
 * phone has no image resizer installed, so the picker's own square crop at a
 * moderate JPEG quality stands in and anything the asset store would refuse is
 * reported instead.
 */

import * as ImagePicker from 'expo-image-picker';

import { avatarImageError } from './look.ts';

export type Picked = { image: string } | { error: string } | null;

/** the library's square crop; null when the user backs out */
export async function pickImageFromDevice(): Promise<Picked> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: true,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  if (!asset.base64) return { error: 'Could not read that image.' };
  const image = `data:image/jpeg;base64,${asset.base64}`;
  const error = avatarImageError(image);
  return error ? { error } : { image };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the generated image.'));
    reader.readAsDataURL(blob);
  });
}

/** `image.generate` answers a data URL, or the backend's own URL when it could not inline it */
export async function generatedAsDataUrl(image: string): Promise<string> {
  if (image.startsWith('data:')) return image;
  const response = await fetch(image);
  if (!response.ok) throw new Error('Could not download the generated image.');
  return readAsDataUrl(await response.blob());
}
