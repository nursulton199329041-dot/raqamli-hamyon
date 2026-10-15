/** Ordered, additive migrations. A migration may only add; user data is never rewritten destructively. */
export const MIGRATIONS: string[][] = [
  [
    'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS ops (id TEXT PRIMARY KEY NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL)',
  ],
  [
    'CREATE TABLE IF NOT EXISTS update_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL)',
  ],
];
