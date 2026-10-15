/** A counter the Files screens watch so a folder or upload made in one refreshes every listing on the stack. */

import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

export function bumpFilesVersion(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useFilesVersion = (): number => useSyncExternalStore(subscribe, () => version);
