/**
 * The warm transcript tail: a bounded slice of each session's newest messages,
 * kept on disk so reopening a session (or the app) paints at once while the
 * server's history reconciles it. Port of the desktop's
 * store/transcript-tail-cache.ts: tail only, size-capped per entry, LRU across
 * sessions, corrupt entries evict themselves, and keyed by the owning
 * connection and profile so one gateway's tail never paints against another's.
 */

import type { Message } from '../chat/transcript.ts';
import type { SqlDb } from './db.ts';
import { TAIL_SAVE_DEBOUNCE_MS, WARM_TAIL_ENTRIES, WARM_TAIL_FALLBACK_MESSAGES, WARM_TAIL_MAX_BYTES, WARM_TAIL_MESSAGES } from './lru.ts';

export type DbSource = () => Promise<SqlDb>;

/** what a restored transcript may hold: settled history, not a half-streamed reply or a stale notice */
export function persistable(messages: readonly Message[]): Message[] {
  return messages.filter((m) => m.status !== 'streaming' && !(m.role === 'system' && m.id.startsWith('live-')));
}

/**
 * The serialized tail for `messages`, or null when there is nothing worth keeping or it is too heavy:
 * the newest WARM_TAIL_MESSAGES if they fit the byte cap, else the newest WARM_TAIL_FALLBACK_MESSAGES.
 * Messages are serialized newest first and one at a time, so a transcript of huge tool results stops
 * at the cap instead of stringifying the whole tail twice on the JS thread.
 */
export function serializeTail(messages: readonly Message[]): string | null {
  const settled = persistable(messages);
  if (settled.length === 0) return null;
  const newest = settled.slice(-WARM_TAIL_MESSAGES);
  const parts: string[] = [];
  let size = 1; // the brackets, less the one comma a joined list saves
  let fallback: { parts: string[]; size: number } | null = null;
  for (let i = newest.length - 1; i >= 0; i -= 1) {
    const part = JSON.stringify(newest[i]);
    parts.push(part);
    size += part.length + 1;
    if (parts.length === WARM_TAIL_FALLBACK_MESSAGES) fallback = { parts: parts.slice(), size };
    if (size <= WARM_TAIL_MAX_BYTES) continue;
    // too heavy: more messages only add to it, so the shorter tail is the last thing that could fit
    if (fallback === null || parts.length <= WARM_TAIL_FALLBACK_MESSAGES) return null;
    return fallback.size <= WARM_TAIL_MAX_BYTES ? `[${fallback.parts.reverse().join(',')}]` : null;
  }
  return `[${parts.reverse().join(',')}]`;
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.role === 'string' && Array.isArray(record.parts);
}

export function parseTail(payload: string): Message[] | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isMessage) ? parsed : null;
  } catch {
    return null;
  }
}

type Pending = { profile: string; session: string; messages: readonly Message[]; timer: ReturnType<typeof setTimeout> };

export class TailStore {
  private readonly pending = new Map<string, Pending>();
  private readonly db: DbSource;
  private readonly conn: string;
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(db: DbSource, conn: string, debounceMs = TAIL_SAVE_DEBOUNCE_MS, now: () => number = Date.now) {
    this.db = db;
    this.conn = conn;
    this.debounceMs = debounceMs;
    this.now = now;
  }

  /** the cached tail, or null; storage trouble reads as a miss, never an error */
  async load(profile: string, session: string): Promise<Message[] | null> {
    try {
      const db = await this.db();
      const [row] = await db.all<{ payload: string }>('SELECT payload FROM tail WHERE conn = ? AND profile = ? AND session = ?', [this.conn, profile, session]);
      if (!row) return null;
      const messages = parseTail(row.payload);
      if (!messages) await this.drop(profile, session);
      return messages;
    } catch {
      return null;
    }
  }

  /** persist now; a session with nothing storable loses its stale entry instead */
  async save(profile: string, session: string, messages: readonly Message[]): Promise<void> {
    try {
      const db = await this.db();
      const payload = serializeTail(messages);
      if (payload === null) {
        await db.run('DELETE FROM tail WHERE conn = ? AND profile = ? AND session = ?', [this.conn, profile, session]);
        return;
      }
      await db.batch([
        ['INSERT OR REPLACE INTO tail (conn, profile, session, saved_at, payload) VALUES (?, ?, ?, ?, ?)', [this.conn, profile, session, this.now(), payload]],
        [
          `DELETE FROM tail WHERE conn = ? AND rowid NOT IN
             (SELECT rowid FROM tail WHERE conn = ? ORDER BY saved_at DESC, rowid DESC LIMIT ${WARM_TAIL_ENTRIES})`,
          [this.conn, this.conn],
        ],
      ]);
    } catch {
      // the next paint is just slower
    }
  }

  /** coalesce rapid changes: only the latest messages for a session are written, after the quiet period */
  schedule(profile: string, session: string, messages: readonly Message[]) {
    const id = `${profile}\u0000${session}`;
    const previous = this.pending.get(id);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      this.pending.delete(id);
      void this.save(profile, session, messages);
    }, this.debounceMs);
    this.pending.set(id, { profile, session, messages, timer });
  }

  /** write everything waiting, for when the app leaves the foreground */
  async flush(): Promise<void> {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) clearTimeout(entry.timer);
    await Promise.all(waiting.map((entry) => this.save(entry.profile, entry.session, entry.messages)));
  }

  async drop(profile: string, session: string): Promise<void> {
    const id = `${profile}\u0000${session}`;
    const waiting = this.pending.get(id);
    if (waiting) clearTimeout(waiting.timer);
    this.pending.delete(id);
    try {
      const db = await this.db();
      await db.run('DELETE FROM tail WHERE conn = ? AND profile = ? AND session = ?', [this.conn, profile, session]);
    } catch {
      // best effort
    }
  }

  /** every tail of this connection, on sign-out */
  async clear(): Promise<void> {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
    try {
      const db = await this.db();
      await db.run('DELETE FROM tail WHERE conn = ?', [this.conn]);
    } catch {
      // best effort
    }
  }
}
