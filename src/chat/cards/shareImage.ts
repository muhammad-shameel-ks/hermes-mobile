import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { dataUrlParts, decodeBase64, downloadFilename } from '../imageFile.ts';
import { mediaMime } from '../media.ts';

/**
 * Hand an image to the system share sheet, whose targets include saving it. The
 * file is written under the cache directory first (the system trims it), since
 * a data URL or a remote URL is not something a share target can open.
 */
export async function shareImage(src: string): Promise<void> {
  const parts = dataUrlParts(src);
  const name = downloadFilename(src, parts?.mime);
  const file = new File(Paths.cache, `hermes-${Date.now()}-${name}`);
  if (parts) {
    file.create({ overwrite: true });
    file.write(decodeBase64(parts.base64));
  } else {
    await File.downloadFileAsync(src, file, { idempotent: true });
  }
  await Sharing.shareAsync(file.uri, { mimeType: parts?.mime ?? mediaMime(name), dialogTitle: 'Save image' });
}
