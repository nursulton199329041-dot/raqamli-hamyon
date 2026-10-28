import type { LocalDb } from '@/local/db';
import type { Storage } from './storage';

/** SQLite-wasm needs special bundler/headers support; on web the localStorage-backed store is used instead. */
export async function openSqliteStorage(): Promise<Storage> {
  throw new Error('SQLite is not available on web');
}

/** No on-device book on web: the app keeps using the server directly. */
export async function openLocalDb(): Promise<LocalDb> {
  throw new Error('SQLite is not available on web');
}
