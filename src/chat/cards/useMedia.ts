import { useEffect, useState } from 'react';

import { isInlineMediaSrc } from '../media.ts';
import type { PlaybackSource } from '../mediaResolver.ts';
import { cardEnv } from './env.ts';

export type Resolved<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' };

function useResolved<T>(path: string, resolve: (path: string) => Promise<T>, immediate: (path: string) => T | null): Resolved<T> {
  const [state, setState] = useState<{ path: string; result: Resolved<T> }>(() => {
    const value = immediate(path);
    return { path, result: value === null ? { status: 'loading' } : { status: 'ready', value } };
  });

  useEffect(() => {
    const value = immediate(path);
    if (value !== null) {
      setState({ path, result: { status: 'ready', value } });
      return;
    }
    let cancelled = false;
    setState({ path, result: { status: 'loading' } });
    resolve(path).then(
      (resolved) => {
        if (!cancelled) setState({ path, result: { status: 'ready', value: resolved } });
      },
      () => {
        if (!cancelled) setState({ path, result: { status: 'failed' } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  // a stale result for the previous path must not paint under the new one
  return state.path === path ? state.result : { status: 'loading' };
}

/** a source an `Image` can load for a path in a reply or tool result */
export function useImageSource(path: string): Resolved<string> {
  return useResolved(
    path,
    (value) => {
      const media = cardEnv().media;
      return media ? media.imageSource(value) : Promise.reject(new Error('no media resolver'));
    },
    (value) => (isInlineMediaSrc(value) ? value : null),
  );
}

/** a seekable source for expo-video or expo-audio */
export function usePlaybackSource(path: string): Resolved<PlaybackSource> {
  return useResolved(
    path,
    (value) => {
      const media = cardEnv().media;
      return media ? media.playbackSource(value) : Promise.reject(new Error('no media resolver'));
    },
    (value) => (isInlineMediaSrc(value) ? { uri: value } : null),
  );
}
