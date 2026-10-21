/**
 * What the board remembers across launches, as the desktop plugin's storage does: the intro's dismissal,
 * "Group Running by profile", and the selected board per gateway (a board lives on one gateway, so each
 * remembers its own instead of pinning a slug the next one 404s on). One small record in the secure store,
 * read once and written on change.
 */
// The secure store is imported where it is used (performance.md "Lists, theme, startup" rule 5), which also keeps
// `parsePrefs` loadable under Node's test runner, where the native module does not exist.

import { useSyncExternalStore } from 'react';

export type KanbanPrefs = {
  introDismissed: boolean;
  groupRunning: boolean;
  /** gateway base URL → selected board slug ('' or absent: the server's current board) */
  boards: Readonly<Record<string, string>>;
};

const PREFS_KEY = 'hermes.kanban.prefs';

export const DEFAULT_PREFS: KanbanPrefs = { introDismissed: false, groupRunning: false, boards: {} };

/** a stored record, tolerating anything older or damaged */
export function parsePrefs(raw: string | null): KanbanPrefs {
  if (!raw) return DEFAULT_PREFS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS;
  const boards: Record<string, string> = {};
  if ('boards' in value && typeof value.boards === 'object' && value.boards !== null) {
    for (const [url, slug] of Object.entries(value.boards)) if (typeof slug === 'string') boards[url] = slug;
  }
  return {
    introDismissed: 'introDismissed' in value && value.introDismissed === true,
    groupRunning: 'groupRunning' in value && value.groupRunning === true,
    boards,
  };
}

let prefs: KanbanPrefs = DEFAULT_PREFS;
let hydrated: Promise<void> | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

function hydrate(): Promise<void> {
  hydrated ??= (async () => {
    try {
      const SecureStore = await import('expo-secure-store');
      const stored = parsePrefs(await SecureStore.getItemAsync(PREFS_KEY));
      // a change made before the read finished wins over what was stored
      if (prefs === DEFAULT_PREFS) {
        prefs = stored;
        notify();
      }
    } catch {
      // no stored record: defaults stand
    }
  })();
  return hydrated;
}

export function setKanbanPrefs(patch: Partial<KanbanPrefs>) {
  prefs = { ...prefs, ...patch };
  notify();
  const snapshot = prefs;
  void (async () => {
    await hydrate();
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(snapshot));
  })().catch(() => undefined);
}

export function setSelectedBoard(baseUrl: string, slug: string) {
  setKanbanPrefs({ boards: { ...prefs.boards, [baseUrl]: slug } });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  void hydrate();
  return () => {
    listeners.delete(listener);
  };
};

const getPrefs = () => prefs;

export function useKanbanPrefs(): KanbanPrefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
