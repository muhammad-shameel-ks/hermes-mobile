/** A counter the kanban screens watch, so a write made on a task's screen refreshes the board under it. */

import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

export function bumpKanbanVersion(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useKanbanVersion = (): number => useSyncExternalStore(subscribe, () => version);
