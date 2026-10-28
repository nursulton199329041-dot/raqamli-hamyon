import type * as SQLite from 'expo-sqlite';
import { serial, type LocalDb, type SqlValue } from './db';

/** LocalDb over an open expo-sqlite connection. */
export function expoDb(db: SQLite.SQLiteDatabase): LocalDb {
  const queue = serial();
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, ...params: SqlValue[]) => ({ changes: (await db.runAsync(sql, ...params)).changes }),
    all: (sql, ...params: SqlValue[]) => db.getAllAsync(sql, ...params),
    first: (sql, ...params: SqlValue[]) => db.getFirstAsync(sql, ...params),
    tx: (work) => queue(async () => {
      let out!: Awaited<ReturnType<typeof work>>;
      await db.withTransactionAsync(async () => {
        out = await work();
      });
      return out;
    }),
  };
}
