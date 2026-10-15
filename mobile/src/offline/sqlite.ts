import * as SQLite from 'expo-sqlite';
import { MIGRATIONS } from './migrations';
import type { Storage, UpdateLogEntry } from './storage';

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let v = row?.user_version ?? 0;
  while (v < MIGRATIONS.length) {
    const steps = MIGRATIONS[v] ?? [];
    await db.withTransactionAsync(async () => {
      for (const sql of steps) await db.execAsync(sql);
    });
    v += 1;
    await db.execAsync(`PRAGMA user_version = ${v}`);
  }
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
  const db = await SQLite.openDatabaseAsync('hamyon.db');
  await migrate(db);
  return new SqliteStorage(db);
}