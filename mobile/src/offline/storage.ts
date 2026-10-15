import { Platform } from 'react-native';
import { openSqliteStorage } from './sqlite';

/**
 * Local persistence. Native: SQLite (expo-sqlite) with explicit schema versioning (PRAGMA user_version).
 * Web: localStorage (SQLite-wasm needs special headers), same interface.
 *
 * Tables
 *   kv(k PRIMARY KEY, v)         – last server snapshot, settings mirror
 *   ops(id PRIMARY KEY, seq, json) – offline operation queue (never dropped by migrations)
 *   update_log(id, at, kind, detail) – OTA / store-update history
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface OpsStore {
  list(): Promise<string[]>;
  replaceAll(items: { id: string; json: string }[]): Promise<void>;
}

export interface UpdateLogEntry { id: number; at: string; kind: string; detail: string }

export interface Storage extends KeyValueStore, OpsStore {
  logUpdate(kind: string, detail: string): Promise<void>;
  updateLog(limit?: number): Promise<UpdateLogEntry[]>;
  clearUserData(): Promise<void>;
}

class WebStorage implements Storage {
  private ls = (): globalThis.Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  private mem = new Map<string, string>();
  private read(k: string) {
    return this.ls()?.getItem(`hamyon:${k}`) ?? this.mem.get(k) ?? null;
  }
  private write(k: string, v: string) {
    this.mem.set(k, v);
    try {
      this.ls()?.setItem(`hamyon:${k}`, v);
    } catch {
      /* quota */
    }
  }
  async get(key: string) {
    return this.read(key);
  }
  async set(key: string, value: string) {
    this.write(key, value);
  }
  async remove(key: string) {
    this.mem.delete(key);
    this.ls()?.removeItem(`hamyon:${key}`);
  }
  async list() {
    const raw = this.read('__ops');
    if (!raw) return [];
    return (JSON.parse(raw) as { json: string }[]).map((x) => x.json);
  }
  async replaceAll(items: { id: string; json: string }[]) {
    this.write('__ops', JSON.stringify(items));
  }
  async logUpdate(kind: string, detail: string) {
    const cur = JSON.parse(this.read('__ulog') ?? '[]') as UpdateLogEntry[];
    cur.unshift({ id: Date.now(), at: new Date().toISOString(), kind, detail });
    this.write('__ulog', JSON.stringify(cur.slice(0, 200)));
  }
  async updateLog(limit = 50) {
    return (JSON.parse(this.read('__ulog') ?? '[]') as UpdateLogEntry[]).slice(0, limit);
  }
  async clearUserData() {
    await this.remove('snapshot');
    await this.remove('profile');
    await this.remove('__ops');
  }
}

let instance: Promise<Storage> | null = null;

export function getStorage(): Promise<Storage> {
  if (!instance) {
    instance = (async () => {
      if (Platform.OS === 'web') return new WebStorage();
      return openSqliteStorage();
    })();
  }
  return instance;
}

/** Test seam. */
export function __setStorageForTests(s: Storage | null) {
  instance = s ? Promise.resolve(s) : null;
}
