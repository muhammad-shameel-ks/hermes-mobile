/**
 * How the transcript reaches media. A path in a reply or a tool result names a
 * file on the gateway's disk; the phone cannot read it, so images come back as
 * data URLs through the dashboard's `/api/fs/read-data-url` (the desktop's own
 * remote-gateway route) and audio and video stream from `/api/files/stream`
 * with the bearer on the request. http(s) and data sources load as they are.
 */

import type { AuthSession } from '../auth/session.ts';
import type { GatewayApi } from '../gateway/api.ts';
import { filePathFromMediaPath, isFileMediaPath, isInlineMediaSrc } from './media.ts';

export type PlaybackSource = { uri: string; headers?: Record<string, string> };

export type MediaResolver = {
  /** a source an `Image` can load */
  imageSource: (path: string) => Promise<string>;
  /** a seekable source for expo-video and expo-audio */
  playbackSource: (path: string) => Promise<PlaybackSource>;
};

/** a cache bounded by what it holds, not by how many entries: data URLs run to megabytes */
export function createByteBudgetCache<V>(budgetBytes: number, sizeOf: (value: V) => number) {
  const entries = new Map<string, { value: V; size: number }>();
  let total = 0;
  return {
    get(key: string): V | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },
    set(key: string, value: V) {
      const size = sizeOf(value);
      if (size > budgetBytes) return;
      const previous = entries.get(key);
      if (previous) total -= previous.size;
      entries.delete(key);
      entries.set(key, { value, size });
      total += size;
      for (const [oldest, entry] of entries) {
        if (total <= budgetBytes) break;
        entries.delete(oldest);
        total -= entry.size;
      }
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return total;
    },
  };
}

const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;

export function createMediaResolver(auth: AuthSession, api: GatewayApi): MediaResolver {
  const cache = createByteBudgetCache<string>(IMAGE_CACHE_BYTES, (value) => value.length);
  const inflight = new Map<string, Promise<string>>();

  const imageSource = (path: string): Promise<string> => {
    if (isInlineMediaSrc(path)) return Promise.resolve(path);
    if (!isFileMediaPath(path)) return Promise.reject(new Error('not a gateway path'));
    const cached = cache.get(path);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(path);
    if (pending) return pending;
    const request = api
      .get<string | { dataUrl?: string }>('/api/fs/read-data-url', { path: filePathFromMediaPath(path) })
      .then((result) => {
        const dataUrl = typeof result === 'string' ? result : (result?.dataUrl ?? '');
        if (!dataUrl) throw new Error('empty image');
        cache.set(path, dataUrl);
        return dataUrl;
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, request);
    return request;
  };

  const playbackSource = async (path: string): Promise<PlaybackSource> => {
    if (isInlineMediaSrc(path)) return { uri: path };
    if (!isFileMediaPath(path)) throw new Error('not a gateway path');
    return {
      uri: `${auth.baseUrl}/api/files/stream?path=${encodeURIComponent(filePathFromMediaPath(path))}`,
      headers: { Authorization: `Bearer ${await auth.accessToken()}` },
    };
  };

  return { imageSource, playbackSource };
}
