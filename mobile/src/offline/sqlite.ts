import * as SQLite from 'expo-sqlite';
import type { LocalDb } from '@/local/db';
import { expoDb } from '@/local/expoDb';
import { migrate } from '@/local/migrate';
import type { Storage, UpdateLogEntry } from './storage';

let opened: Promise<{ raw: SQLite.SQLiteDatabase; db: LocalDb; failed: unknown }> | null = null;

/**
 * One connection to hamyon.db (snapshot cache, queue and the local ledger), migrated before first use. A failed
 * migration rolls back to the previous version: the queue and cache keep working, only the local ledger stays closed.
 */
function open() {
  opened ??= (async () => {
    const raw = await SQLite.openDatabaseAsync('hamyon.db');
    await raw.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const db = expoDb(raw);
    let failed: unknown = null;
    try {
      await migrate(db);
    } catch (e) {
      failed = e;
      try {
        await raw.runAsync('INSERT INTO update_log (at, kind, detail) VALUES (?, ?, ?)', new Date().toISOString(), 'db-migration-failed',
          e instanceof Error ? e.message.slice(0, 500) : String(e));
      } catch {
        /* the log table itself may be missing on a very old file */
      }
    }
    return { raw, db, failed };
  })();
  return opened;
}

export async function openLocalDb(): Promise<LocalDb> {
  const o = await open();
  if (o.failed) throw o.failed;
  return o.db;
}

class SqliteStorage implements Storage {
  constructor(private db: SQLite.SQLiteDatabase) {}

  async get(key: string) {
    const r = await this.db.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', key);
    return r?.v ?? null;
  }
  async set(key: string, value: string) {
    await this.db.runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', key, value);
  }
  async remove(key: string) {
    await this.db.runAsync('DELETE FROM kv WHERE k = ?', key);
  }
  async list() {
    const rows = await this.db.getAllAsync<{ json: string }>('SELECT json FROM ops ORDER BY seq ASC');
    return rows.map((r) => r.json);
  }
  async replaceAll(items: { id: string; json: string }[]) {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM ops');
      let seq = 0;
      for (const it of items) await this.db.runAsync('INSERT INTO ops (id, seq, json) VALUES (?, ?, ?)', it.id, seq++, it.json);
    });
  }
  async logUpdate(kind: string, detail: string) {
    await this.db.runAsync('INSERT INTO update_log (at, kind, detail) VALUES (?, ?, ?)', new Date().toISOString(), kind, detail);
    await this.db.runAsync('DELETE FROM update_log WHERE id NOT IN (SELECT id FROM update_log ORDER BY id DESC LIMIT 200)');
  }
  async updateLog(limit = 50) {
    return this.db.getAllAsync<UpdateLogEntry>('SELECT id, at, kind, detail FROM update_log ORDER BY id DESC LIMIT ?', limit);
  }
  async clearUserData() {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync("DELETE FROM kv WHERE k NOT LIKE 'setting:%'");
      await this.db.runAsync('DELETE FROM ops');
    });
  }
}


export async function openSqliteStorage(): Promise<Storage> {
  return new SqliteStorage((await open()).raw);
}