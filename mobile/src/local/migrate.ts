import { MIGRATIONS } from '@/offline/migrations';
import type { LocalDb } from './db';

export class MigrationError extends Error {
  constructor(public version: number, cause: unknown) {
    super(`Local database migration to v${version} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'MigrationError';
  }
}

/**
 * Brings the database to the latest schema. Each version's statements AND its user_version bump commit together, so a
 * crash or error mid-way leaves the previous version fully intact (never a half-applied schema, never lost rows); the
 * next start simply retries. Returns the version the database is at.
 */
export async function migrate(db: LocalDb, migrations: string[][] = MIGRATIONS): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  let v = row?.user_version ?? 0;
  if (v > migrations.length) {
    // Written by a newer app version (e.g. after a downgrade): open as is, never "repair" it destructively.
    return v;
  }
  while (v < migrations.length) {
    const next = v + 1;
    try {
      await db.tx(async () => {
        for (const sql of migrations[v] ?? []) await db.exec(sql);
        await db.exec(`PRAGMA user_version = ${next}`);
        const hasLog = await db.first<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
        if (hasLog?.n) await db.run('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', next, new Date().toISOString());
      });
    } catch (e) {
      throw new MigrationError(next, e);
    }
    v = next;
  }
  return v;
}
