/**
 * Moving bytes between the gateway and the phone: authenticated downloads into
 * the cache (for preview and share) or a folder the reader picks, multipart
 * uploads into the files root, and the share sheet. Native modules only; the URL
 * and error shapes live in rest.ts so they stay testable.
 */

import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { Linking } from 'react-native';

import { gateway } from './gateway.ts';
import { downloadUrl, type DownloadSpec } from './rest.ts';
import { isPickerCancelled, safeFileName } from './save.ts';

const bearer = async () => ({ Authorization: `Bearer ${await gateway().auth.accessToken()}` });

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'hermes-files');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Download one file into the app cache, replacing an earlier copy. */
export async function downloadToCache(spec: DownloadSpec & { name?: string }): Promise<File> {
  return downloadUrlToCache(downloadUrl(gateway().auth.baseUrl, spec), spec.name ?? spec.path);
}

/** Download any authenticated gateway URL into the app cache as `name`, replacing an earlier copy. */
export async function downloadUrlToCache(url: string, name: string): Promise<File> {
  const target = new File(cacheDirectory(), safeFileName(name));
  return File.downloadFileAsync(url, target, { headers: await bearer(), idempotent: true });
}

/**
 * Save a gateway file into a folder the reader picks. Resolves false when they
 * cancel the picker.
 *
 * The folder is a SAF `content://` tree on Android, which `File.downloadFileAsync`
 * cannot write into (it resolves the destination through `javaFile`, which throws
 * for content URIs), and its file name would come from the response headers. So the
 * bytes land in a private scratch folder under the right name first, then `File.copy`
 * moves them into the picked folder (SAF-aware on Android, `FileManager` inside the
 * picker's security scope on iOS), replacing an earlier copy. The scratch folder is
 * removed either way.
 */
export async function downloadToFolder(spec: DownloadSpec & { name?: string }): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch (e) {
    if (isPickerCancelled(e)) return false;
    throw new Error(`Could not open the folder picker: ${e instanceof Error ? e.message : String(e)}`);
  }

  const scratch = new Directory(cacheDirectory(), `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    scratch.create({ intermediates: true, idempotent: true });
    const target = new File(scratch, safeFileName(spec.name ?? spec.path));
    const saved = await File.downloadFileAsync(downloadUrl(gateway().auth.baseUrl, spec), target, { headers: await bearer(), idempotent: true });
    await saved.copy(folder, { overwrite: true });
  } finally {
    try {
      scratch.delete();
    } catch {
      // the cache is the system's to clear if this fails
    }
  }
  return true;
}

export type UploadSource = { uri: string; name: string; mimeType?: string | null };

/** Stream one local file to `destination` (an absolute path under the files root), overwriting like the dashboard. */
export async function uploadFile(source: UploadSource, destination: string): Promise<void> {
  await uploadMultipart(`${gateway().auth.baseUrl}/api/files/upload-stream`, source, { path: destination, overwrite: 'true' });
}

/** Stream one local file as the multipart field `file` to an authenticated gateway URL. */
export async function uploadMultipart(url: string, source: UploadSource, parameters?: Record<string, string>): Promise<void> {
  const result = await new File(source.uri).upload(url, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: source.mimeType ?? undefined,
    headers: await bearer(),
    parameters,
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
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

/** Write text to the cache so it can be shared as a file (the HTML artifact's browser hand-off). */
export function writeCacheText(name: string, text: string): File {
  const file = new File(cacheDirectory(), safeFileName(name));
  file.create({ overwrite: true });
  file.write(text);
  return file;
}

/** `url` targets leave the app: the system browser takes them. */
export const openInBrowser = (url: string) => Linking.openURL(url);
