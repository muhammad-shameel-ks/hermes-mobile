import { DatabaseSync } from 'node:sqlite';

import { migrate, type SqlDb, type SqlValue } from '../../src/store/db.ts';

/** a real SQLite behind the store's handle, in memory, for tests */
export async function memoryDb(): Promise<SqlDb> {
  const native = new DatabaseSync(':memory:');
  const db: SqlDb = {
    exec: async (sql) => void native.exec(sql),
    run: async (sql, params = []) => void native.prepare(sql).run(...(params as SqlValue[])),
    all: async <T>(sql: string, params: readonly SqlValue[] = []) => native.prepare(sql).all(...(params as SqlValue[])).map((row) => ({ ...row })) as T[],
    batch: async (statements) => {
      native.exec('BEGIN');
      try {
        for (const [sql, params = []] of statements) native.prepare(sql).run(...(params as SqlValue[]));
        native.exec('COMMIT');
      } catch (error) {
        native.exec('ROLLBACK');
        throw error;
      }
    },
  };
  await migrate(db);
  return db;
}
