/**
 * Retention caps. The values are the desktop's: `MAX_SESSION_WINDOWS`
 * (app/chat/transcript-window.ts), and `TAIL_MESSAGES` / `MAX_ENTRY_BYTES` /
 * `MAX_ENTRIES` (store/transcript-tail-cache.ts), `MAX_PERSISTED_DRAFTS` and
 * `DRAFT_PERSIST_DEBOUNCE_MS` (store/composer.ts, composer-utils.ts). The
 * 256-entry tail bookkeeping cap has no counterpart: paging state lives on the
 * session's own entry here, which the 12-session cap already bounds.
 */

/** sessions that keep their transcript in memory once settled */
export const SESSION_STATE_LRU = 12;
/** messages kept per session in the warm tail */
export const WARM_TAIL_MESSAGES = 40;
/** shorter tail tried when a session's last turns are too heavy for the cap */
export const WARM_TAIL_FALLBACK_MESSAGES = 8;
export const WARM_TAIL_MAX_BYTES = 256 * 1024;
/** sessions that keep a warm tail on disk */
export const WARM_TAIL_ENTRIES = 50;
export const DRAFT_ENTRIES = 50;
export const DRAFT_PERSIST_DEBOUNCE_MS = 400;
/** quiet time after a transcript settles before its tail is written */
export const TAIL_SAVE_DEBOUNCE_MS = 1500;

/**
 * The keys to drop so at most `cap` unprotected keys stay, oldest first.
 * `recency` is ordered least to most recently used; protected keys (open,
 * running, loading) never count toward the cap and are never dropped.
 */
export function evictions(recency: readonly string[], isProtected: (key: string) => boolean, cap: number): string[] {
  const candidates = recency.filter((key) => !isProtected(key));
  return candidates.slice(0, Math.max(0, candidates.length - cap));
}

/** A recency order that moves a key to the most-recent end each time it is touched. */
export class Recency {
  private readonly order = new Set<string>();

  touch(key: string) {
    this.order.delete(key);
    this.order.add(key);
  }

  has(key: string): boolean {
    return this.order.has(key);
  }

  forget(key: string) {
    this.order.delete(key);
  }

  /** least to most recently used */
  keys(): string[] {
    return [...this.order];
  }
}
