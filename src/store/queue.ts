/**
 * The queue's durable copy (issue "Transcript and composer parity on touch": a
 * queued prompt survives an app kill but never fires while the gateway is
 * closed). The store keeps the queue's items opaque - one JSON list per
 * session - so the queue owns its own item shape.
 */

import type { DbSource } from './sessions.ts';

export class QueueStore {
  private readonly db: DbSource;
  private readonly conn: string;
  private readonly now: () => number;

  constructor(db: DbSource, conn: string, now: () => number = Date.now) {
    this.db = db;
    this.conn = conn;
    this.now = now;
  }

  async load<T>(profile: string, session: string): Promise<T[]> {
    try {
      const db = await this.db();
      const [row] = await db.all<{ payload: string }>('SELECT payload FROM queue WHERE conn = ? AND profile = ? AND session = ?', [this.conn, profile, session]);
      const parsed: unknown = row ? JSON.parse(row.payload) : [];
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  /** an empty queue removes the row */
  async save<T>(profile: string, session: string, items: readonly T[]): Promise<void> {
    try {
      const db = await this.db();
      if (items.length === 0) {
        await db.run('DELETE FROM queue WHERE conn = ? AND profile = ? AND session = ?', [this.conn, profile, session]);
        return;
      }
      await db.run('INSERT OR REPLACE INTO queue (conn, profile, session, updated_at, payload) VALUES (?, ?, ?, ?, ?)', [
        this.conn,
        profile,
        session,
        this.now(),
        JSON.stringify(items),
      ]);
    } catch {
      // the queue then lives for this run only
    }
  }

  /** every session's queue of this connection, to rebuild the queues after a restart */
  async all<T>(): Promise<Array<{ profile: string; session: string; items: T[] }>> {
    try {
      const db = await this.db();
      const rows = await db.all<{ profile: string; session: string; payload: string }>('SELECT profile, session, payload FROM queue WHERE conn = ?', [this.conn]);
      return rows.flatMap((row) => {
        try {
          const items: unknown = JSON.parse(row.payload);
          return Array.isArray(items) ? [{ profile: row.profile, session: row.session, items: items as T[] }] : [];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }
}
