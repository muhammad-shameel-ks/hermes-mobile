/**
 * Screens that are not on the launch path (Settings, Files, Review, the preview viewer) load when
 * first rendered instead of when the app starts, so launch does not evaluate their modules or the
 * native modules only they use. `preloadLazyScreens` evaluates the rest once the app is idle, so a
 * first tap never pays for it either.
 *
 *   const FilesScreen = lazyScreen(() => require('./FilesScreen.tsx'));
 */

import { createElement, type ComponentType } from 'react';

const loaders: Array<() => unknown> = [];
let preloadStarted = false;

/** `preload: false` keeps a screen out of `preloadLazyScreens`, for one a signed-in phone rarely needs. */
export function lazyScreen<P extends object>(load: () => { default: ComponentType<P> }, { preload = true } = {}): ComponentType<P> {
  let Screen: ComponentType<P> | undefined;
  const resolve = () => (Screen ??= load().default);
  if (preload) loaders.push(resolve);
  return function LazyScreen(props: P) {
    return createElement(resolve(), props);
  };
}

/** Evaluate every lazy screen's module, one per timer tick, after `delayMs`; safe to call more than once. */
export function preloadLazyScreens(delayMs = 4000, gapMs = 250): void {
  if (preloadStarted) return;
  preloadStarted = true;
  let next = 0;
  const step = () => {
    const load = loaders[next++];
    if (!load) return;
    try {
      load();
    } catch {
      // the screen will load, and report, when it is opened
    }
    setTimeout(step, gapMs);
  };
  setTimeout(step, delayMs);
}
