/**
 * The one on-device SQLite store (issue "Transcript and composer parity on touch":
 * drafts, the queue and the warm transcript tail share a single `expo-sqlite`
 * database). Everything above this file talks to the narrow `SqlDb` handle, so
 * the pure logic runs under node against any driver and the native module is
 * only ever imported by `openDb`.
 */

export type SqlValue = string | number | null;
export type SqlStatement = readonly [sql: string, params?: readonly SqlValue[]];

export type SqlDb = {
  exec: (sql: string) => Promise<void>;
  run: (sql: string, params?: readonly SqlValue[]) => Promise<void>;
  all: <T>(sql: string, params?: readonly SqlValue[]) => Promise<T[]>;
  /** the statements land together or not at all */
  batch: (statements: readonly SqlStatement[]) => Promise<void>;
};

export const DB_NAME = 'hermes-mobile.db';

/** each entry upgrades the schema by one `user_version` */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE tail (
     conn TEXT NOT NULL,
     profile TEXT NOT NULL,
     session TEXT NOT NULL,
     saved_at INTEGER NOT NULL,
     payload TEXT NOT NULL,
     PRIMARY KEY (conn, profile, session)
   );
   CREATE TABLE draft (
     conn TEXT NOT NULL,
     profile TEXT NOT NULL,
     session TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     text TEXT NOT NULL,
     PRIMARY KEY (conn, profile, session)
   );
   CREATE TABLE queue (
     conn TEXT NOT NULL,
     profile TEXT NOT NULL,
     session TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     payload TEXT NOT NULL,
     PRIMARY KEY (conn, profile, session)
   );`,
];

export async function migrate(db: SqlDb): Promise<void> {
  const [row] = await db.all<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  for (let version = from; version < MIGRATIONS.length; version += 1) {
    try {
      await db.exec(`BEGIN; ${MIGRATIONS[version]} PRAGMA user_version = ${version + 1}; COMMIT;`);
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
}

let shared: Promise<SqlDb> | null = null;

/** The app's database, opened and migrated once. A failed open is retried by the next caller. */
export function openDb(): Promise<SqlDb> {
  if (!shared) {
    shared = openNative().catch((error) => {
      shared = null;
      throw error;
    });
  }
  return shared;
}

async function openNative(): Promise<SqlDb> {
  const { openDatabaseAsync } = await import('expo-sqlite');
  const native = await openDatabaseAsync(DB_NAME);
  await native.execAsync('PRAGMA journal_mode = WAL;');
  // one operation at a time: a transaction must not interleave with another store's write
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
  const db: SqlDb = {
    exec: (sql) => serial(() => native.execAsync(sql)),
    run: (sql, params = []) => serial(async () => void (await native.runAsync(sql, [...params]))),
    all: <T>(sql: string, params: readonly SqlValue[] = []) => serial(() => native.getAllAsync<T>(sql, [...params])),
    batch: (statements) =>
      serial(() =>
        native.withTransactionAsync(async () => {
          for (const [sql, params = []] of statements) await native.runAsync(sql, [...params]);
        }),
      ),
  };
  await migrate(db);
  return db;
}
