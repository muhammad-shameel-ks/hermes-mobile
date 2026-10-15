/**
 * Per-session composer drafts. Port of the desktop's draft stash
 * (store/composer.ts): text only, the newest 50 kept, written 400 ms after the
 * last keystroke, and a session that turns out to be gone hands its unsent text
 * to the fresh chat with an undoable "Restored your unsent message" notice.
 *
 * Reads are synchronous against an in-memory map that hydrates from the
 * database once; whatever the reader typed before hydration lands wins.
 */

import type { SqlDb, SqlStatement } from './db.ts';
import { DRAFT_ENTRIES, DRAFT_PERSIST_DEBOUNCE_MS } from './lru.ts';
import type { DbSource } from './sessions.ts';

export const FRESH_DRAFT_KEY = 'draft';

export type RestoredDraft = { profile: string; fromKey: string; text: string };

const idOf = (profile: string, session: string) => `${profile}\u0000${session}`;
const split = (id: string): [string, string] => {
  const at = id.indexOf('\u0000');
  return [id.slice(0, at), id.slice(at + 1)];
};
const blank = (text: string | undefined) => !text || text.trim() === '';

export class DraftStore {
  private readonly drafts = new Map<string, string>();
  private readonly dirty = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private restored: RestoredDraft | null = null;
  private readonly db: DbSource | null;
  private readonly conn: string;
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(db: DbSource | null, conn: string, debounceMs = DRAFT_PERSIST_DEBOUNCE_MS, now: () => number = Date.now) {
    this.db = db;
    this.conn = conn;
    this.debounceMs = debounceMs;
    this.now = now;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) listener();
  }

  /** load the saved drafts; text already typed this run is kept over the saved copy */
  async hydrate(): Promise<void> {
    if (!this.db) return;
    try {
      const db = await this.db();
      const rows = await db.all<{ profile: string; session: string; text: string }>(
        'SELECT profile, session, text FROM draft WHERE conn = ? ORDER BY rowid ASC',
        [this.conn],
      );
      const live = new Map(this.drafts);
      this.drafts.clear();
      for (const row of rows) if (!live.has(idOf(row.profile, row.session))) this.drafts.set(idOf(row.profile, row.session), row.text);
      for (const [id, text] of live) this.drafts.set(id, text);
      this.notify();
    } catch {
      // drafts then live for this run only
    }
  }

  get(profile: string, session: string): string {
    return this.drafts.get(idOf(profile, session)) ?? '';
  }

  set(profile: string, session: string, text: string) {
    const id = idOf(profile, session);
    if ((this.drafts.get(id) ?? '') === text) return;
    // delete-then-set keeps the newest at the end for the cap
    this.drafts.delete(id);
    this.drafts.set(id, text);
    this.dirty.add(id);
    this.enforceCap();
    if (this.restored && this.restored.profile === profile && session === FRESH_DRAFT_KEY && blank(text)) this.restored = null;
    this.notify();
    this.schedule();
  }

  /** a sent or emptied draft */
  clear(profile: string, session: string) {
    this.set(profile, session, '');
    this.release(profile, session);
  }

  /** the reader left this session's composer: a blank entry has nothing left to keep */
  release(profile: string, session: string) {
    const id = idOf(profile, session);
    if (blank(this.drafts.get(id))) this.drafts.delete(id);
  }

  private enforceCap() {
    // blank entries do not count, so a map at or under the cap cannot be over it: the common keystroke
    if (this.drafts.size <= DRAFT_ENTRIES) return;
    let kept = 0;
    for (const [, text] of this.drafts) if (!blank(text)) kept += 1;
    for (const [id, text] of this.drafts) {
      if (kept <= DRAFT_ENTRIES) break;
      if (blank(text)) continue;
      this.drafts.delete(id);
      this.dirty.add(id);
      kept -= 1;
    }
  }

  private schedule() {
    if (!this.db) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** write what changed now: on leaving the foreground and when a composer unmounts */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.db || this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    const statements: SqlStatement[] = [];
    for (const id of ids) {
      const [profile, session] = split(id);
      const text = this.drafts.get(id);
      statements.push(
        blank(text)
          ? ['DELETE FROM draft WHERE conn = ? AND profile = ? AND session = ?', [this.conn, profile, session]]
          : ['INSERT OR REPLACE INTO draft (conn, profile, session, updated_at, text) VALUES (?, ?, ?, ?, ?)', [this.conn, profile, session, this.now(), text as string]],
      );
    }
    statements.push([
      `DELETE FROM draft WHERE conn = ? AND rowid NOT IN
         (SELECT rowid FROM draft WHERE conn = ? ORDER BY rowid DESC LIMIT ${DRAFT_ENTRIES})`,
      [this.conn, this.conn],
    ]);
    try {
      const db: SqlDb = await this.db();
      await db.batch(statements);
    } catch {
      for (const id of ids) this.dirty.add(id);
    }
  }

  // ─── a session that turned out to be gone ───────────────────────────────────

  getRestored = () => this.restored;

  /**
   * The unsent text of a deleted session moves onto the fresh chat and a notice offers to
   * undo. Declines when there is nothing to move or the reader is already composing a new chat.
   */
  adoptGone(profile: string, session: string): boolean {
    const text = this.drafts.get(idOf(profile, session));
    if (blank(text) || !blank(this.drafts.get(idOf(profile, FRESH_DRAFT_KEY)))) return false;
    this.set(profile, FRESH_DRAFT_KEY, text as string);
    this.clear(profile, session);
    this.restored = { profile, fromKey: session, text: text as string };
    this.notify();
    return true;
  }

  dismissRestored = () => {
    if (!this.restored) return;
    this.restored = null;
    this.notify();
  };

  /** put the text back where it came from; only while the composer still holds exactly what was restored */
  undoRestored(liveText: string): boolean {
    const notice = this.restored;
    this.restored = null;
    if (!notice || liveText !== notice.text) {
      this.notify();
      return false;
    }
    this.set(notice.profile, notice.fromKey, notice.text);
    this.clear(notice.profile, FRESH_DRAFT_KEY);
    this.notify();
    return true;
  }
}
