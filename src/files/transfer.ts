/**
 * Moving bytes between the gateway and the phone: authenticated downloads into
 * the cache (for preview and share) or a folder the reader picks, multipart
 * uploads into the files root, and the share sheet. Native modules only; the URL
 * and error shapes live in rest.ts so they stay testable.
 */

import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking } from 'react-native';

import { gateway } from './gateway.ts';
import { baseName } from './path.ts';
import { downloadUrl, type DownloadSpec } from './rest.ts';

const bearer = async () => ({ Authorization: `Bearer ${await gateway().auth.accessToken()}` });

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'hermes-files');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const safeName = (name: string) => baseName(name).replace(/[^\w.\- ]+/g, '_') || 'file';

/** Download one file into the app cache, replacing an earlier copy. */
export async function downloadToCache(spec: DownloadSpec & { name?: string }): Promise<File> {
  const { auth } = gateway();
  const target = new File(cacheDirectory(), safeName(spec.name ?? spec.path));
  return File.downloadFileAsync(downloadUrl(auth.baseUrl, spec), target, { headers: await bearer(), idempotent: true });
}

/** Download into a folder the reader picks (Android's document tree). Resolves false when they cancel. */
export async function downloadToFolder(spec: DownloadSpec): Promise<boolean> {
  const { auth } = gateway();
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  await File.downloadFileAsync(downloadUrl(auth.baseUrl, spec), folder, { headers: await bearer(), idempotent: true });
  return true;
}

export type UploadSource = { uri: string; name: string; mimeType?: string | null };

/** Stream one local file to `destination` (an absolute path under the files root), overwriting like the dashboard. */
export async function uploadFile(source: UploadSource, destination: string): Promise<void> {
  const { auth } = gateway();
  const result = await new File(source.uri).upload(`${auth.baseUrl}/api/files/upload-stream`, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: source.mimeType ?? undefined,
    headers: await bearer(),
    parameters: { path: destination, overwrite: 'true' },
  });
  if (result.status < 200 || result.status >= 300) {
    let detail = '';
    try {
      const parsed = JSON.parse(result.body) as { detail?: unknown };
      if (typeof parsed.detail === 'string') detail = parsed.detail;
    } catch {
      // not JSON
    }
    throw new Error(detail || `The gateway answered ${result.status}`);
  }
}

export async function shareFile(uri: string, mimeType: string, title?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

/** Write text to the cache so it can be shared as a file (the HTML artifact's browser hand-off). */
export function writeCacheText(name: string, text: string): File {
  const file = new File(cacheDirectory(), safeName(name));
  file.create({ overwrite: true });
  file.write(text);
  return file;
}

export const copyText = (text: string) => Clipboard.setStringAsync(text);

/** `url` targets leave the app: the system browser takes them. */
export const openInBrowser = (url: string) => Linking.openURL(url);
