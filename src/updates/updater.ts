/**
 * The updater's native half: the GitHub request, the APK download into the
 * cache and the hand-off to Android's package installer. Sideloaded Android
 * builds only - iOS and dev clients never offer an update.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import app from '../../app.json';
import { LATEST_RELEASE_URL, parseRelease, type Release } from './release.ts';
import { UpdateStore } from './store.ts';

const SKIPPED_KEY = 'hermes.update.skipped';
const APK_MIME = 'application/vnd.android.package-archive';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION */
const GRANT_READ_URI = 1;

/** Updates install a sideloaded APK, so only release Android builds offer them. */
export const UPDATES_SUPPORTED = Platform.OS === 'android';
export const AUTO_CHECK_ENABLED = UPDATES_SUPPORTED && !__DEV__;

async function fetchLatest(): Promise<Release | null> {
  const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return parseRelease(await response.json());
}

function updatesDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'hermes-updates');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function download(release: Release, onProgress: (written: number, total: number) => void): Promise<string> {
  const name = release.apkName.replace(/[^\w.\-]+/g, '_') || `hermes-${release.version}.apk`;
  const target = new File(updatesDirectory(), name);
  const file = await File.downloadFileAsync(release.apkUrl, target, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes > 0 ? totalBytes : release.apkSize),
  });
  return file.uri;
}

async function install(fileUri: string): Promise<void> {
  const contentUri = await getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, type: APK_MIME, flags: GRANT_READ_URI });
}

export const updates = new UpdateStore({
  currentVersion: app.expo.version,
  fetchLatest,
  download,
  install,
  loadSkipped: () => SecureStore.getItemAsync(SKIPPED_KEY),
  saveSkipped: async (version) => {
    if (version === null) await SecureStore.deleteItemAsync(SKIPPED_KEY);
    else await SecureStore.setItemAsync(SKIPPED_KEY, version);
  },
});
