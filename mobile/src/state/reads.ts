import { localGet, type LocalQuery } from '@/local/analytics';
import { currentBook } from './queue';
import { api } from './runtime';

/**
 * Reads for the history and report screens. With the device's book (offline-first or guest) they are answered from it,
 * so reports work with no connection; otherwise from the server as before.
 */
export async function read<T>(path: string, q?: LocalQuery): Promise<T> {
  const opening = currentBook();
  const book = opening && (await opening);
  if (book) {
    const local = await localGet(book.db, book.profileId, path, q ?? {});
    if (local !== null) return local as T;
  }
  return api.get<T>(path, q as Record<string, string | number | boolean | undefined | null>);
}
