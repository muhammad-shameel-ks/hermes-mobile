/**
 * What the chat controller gets for one connection: the drafts, the warm tails
 * and the queue, all riding the app's single database.
 */

import { openDb } from './db.ts';
import { DraftStore } from './drafts.ts';
import { QueueStore } from './queue.ts';
import { TailStore, type DbSource } from './sessions.ts';

export type Persistence = {
  drafts: DraftStore;
  tails: TailStore;
  queue: QueueStore;
  /** write everything waiting, for when the app leaves the foreground */
  flush: () => Promise<void>;
};

/** Persistence over any handle; `createPersistence` is the app's own. */
export function persistenceOver(db: DbSource, connectionId: string): Persistence {
  const drafts = new DraftStore(db, connectionId);
  const tails = new TailStore(db, connectionId);
  const queue = new QueueStore(db, connectionId);
  void drafts.hydrate();
  return { drafts, tails, queue, flush: async () => void (await Promise.all([drafts.flush(), tails.flush()])) };
}

/** a signed-out connection leaves nothing of its transcripts, drafts or queues on the phone */
export async function wipeConnection(connectionId: string, db: DbSource = openDb): Promise<void> {
  const handle = await db();
  await handle.batch(['tail', 'draft', 'queue'].map((table) => [`DELETE FROM ${table} WHERE conn = ?`, [connectionId]] as const));
}

export function createPersistence(connectionId: string): Persistence {
  return persistenceOver(openDb, connectionId);
}
