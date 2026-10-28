import { serial, type LocalDb, type SqlValue } from '@/local/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/**
 * LocalDb over Node's built-in SQLite: the real engine runs the app's real SQL in tests (constraints, transactions,
 * PRAGMA user_version). `path` may be a file to test closing and reopening the database.
 */
export function nodeDb(path = ':memory:'): LocalDb & { close(): void; raw: InstanceType<typeof DatabaseSync> } {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  const queue = serial();
  const bind = (p: SqlValue[]) => p.map((x) => (x === undefined ? null : x));
  return {
    raw,
    close: () => raw.close(),
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, ...p) => ({ changes: Number(raw.prepare(sql).run(...bind(p)).changes) }),
    all: async <T,>(sql: string, ...p: SqlValue[]) => raw.prepare(sql).all(...bind(p)) as T[],
    first: async <T,>(sql: string, ...p: SqlValue[]) => (raw.prepare(sql).get(...bind(p)) as T | undefined) ?? null,
    tx: (work) => queue(async () => {
      raw.exec('BEGIN');
      try {
        const out = await work();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    }),
  };
}
