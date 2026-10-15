import { Asset, requestPermissionsAsync } from 'expo-media-library';

import { saveNotice, type SaveNotice } from '../imageFile.ts';
import { imageToCacheFile } from './shareImage.ts';

/**
 * Write an image (data URL, remote URL or a local file) to the photo library.
 * The permission is asked for on first use, write-only; a refusal is reported
 * rather than thrown so the caller can say how to change it.
 */
export async function saveImageToLibrary(src: string): Promise<SaveNotice> {
  try {
    const permission = await requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) return saveNotice('denied');
    const uri = /^file:/i.test(src) ? src : (await imageToCacheFile(src)).uri;
    await Asset.create(uri);
    return saveNotice('saved');
  } catch (error) {
    return saveNotice({ error });
  }
}
