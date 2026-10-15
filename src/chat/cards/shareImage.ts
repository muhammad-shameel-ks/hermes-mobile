import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { dataUrlParts, decodeBase64, downloadFilename } from '../imageFile.ts';
import { mediaMime } from '../media.ts';

/**
 * A file under the cache directory (the system trims it) holding the image, since
 * a data URL or a remote URL is not something a share target or the photo library
 * can open.
 */
export async function imageToCacheFile(src: string): Promise<{ uri: string; mime: string }> {
  const parts = dataUrlParts(src);
  const name = downloadFilename(src, parts?.mime);
  const file = new File(Paths.cache, `hermes-${Date.now()}-${name}`);
  if (parts) {
    file.create({ overwrite: true });
    file.write(decodeBase64(parts.base64));
  } else {
    await File.downloadFileAsync(src, file, { idempotent: true });
  }
  return { uri: file.uri, mime: parts?.mime ?? mediaMime(name) };
}

/** Hand an image to the system share sheet. */
export async function shareImage(src: string): Promise<void> {
  const file = await imageToCacheFile(src);
  await Sharing.shareAsync(file.uri, { mimeType: file.mime, dialogTitle: 'Share image' });
}
