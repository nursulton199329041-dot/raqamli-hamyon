/**
 * The small SQL surface the local store needs. Implemented over expo-sqlite on devices and over Node's built-in SQLite in
 * tests, so the very same SQL (schema, migrations, ledger postings) is exercised by the test suite.
 * Parameters are always bound (never interpolated); booleans are passed as 0/1.
 */
export type SqlValue = string | number | null;

export interface LocalDb {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  /** Runs `work` in one transaction: COMMIT when it resolves, ROLLBACK (and rethrow) when it throws. Serialized. */
  tx<T>(work: () => Promise<T>): Promise<T>;
}

/** Serializes transactions issued through one connection (expo-sqlite would otherwise interleave statements). */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
}
