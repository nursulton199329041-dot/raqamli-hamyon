import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { ApiError } from '@/api/client';
import type { Snapshot } from '@/api/types';
import { CURRENT_PROFILE_KEY, localSnapshot, resetLocalBook } from '@/local/bridge';
import { openLocalDb } from '@/offline/sqlite';
import { getStorage } from '@/offline/storage';
import { currentBook, useQueue } from './queue';
import { api, queryClient } from './runtime';
import { PROFILES_CACHE_KEY, PROFILE_STORE_KEY, useSession } from './session';

export interface ProfileRow { id: string; name: string; color: string; icon: string; baseCurrency: string }
interface ServerProfile extends ProfileRow { sortOrder: number; isArchived: boolean; isCurrent: boolean; revision: number }
export interface ProfileList { items: ProfileRow[]; currentId: string | null }

/** The account's active profiles: from the device's book when there is one (works offline), else from the server. */
async function loadProfiles(): Promise<ProfileList> {
  const opening = currentBook();
  const book = opening && (await opening);
  if (!book) {
    const store = await getStorage();
    let rows: ServerProfile[];
    try {
      rows = await api.get<ServerProfile[]>('/api/profiles');
      await store.set(PROFILES_CACHE_KEY, JSON.stringify(rows));
    } catch (e) {
      // no connection: the list from the last time, like the rest of the screens
      const cached = e instanceof ApiError && e.isNetwork ? await store.get(PROFILES_CACHE_KEY) : null;
      if (!cached) throw e;
      rows = JSON.parse(cached) as ServerProfile[];
    }
    const items = rows.filter((r) => !r.isArchived);
    const chosen = api.getProfileId();
    return { items, currentId: items.find((r) => (chosen ? r.id === chosen : r.isCurrent))?.id ?? items[0]?.id ?? null };
  }
  const user = useSession.getState().user;
  if (book.engine && user) {
    try {
      await book.ledger.adoptCloudAccount(user, await api.get<ServerProfile[]>('/api/profiles'));
    } catch {
      /* offline: the list the device already knows */
    }
  }
  const items = await book.db.all<ProfileRow>(
    'SELECT id, name, color, icon, base_currency AS baseCurrency FROM profiles WHERE is_archived = 0 ORDER BY sort_order, created_at');
  return { items, currentId: book.profileId };
}

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: loadProfiles, staleTime: 60_000 });
}

/**
 * Opens another profile: everything on screen is loaded again from it. A server-only device with unsent operations
 * must deliver them first, since they carry no profile of their own and would land in the new one.
 */
export async function selectProfile(id: string): Promise<void> {
  const opening = currentBook();
  const book = opening && (await opening);
  if (!book) {
    if (useQueue.getState().pending.length > 0) throw new ApiError(409, 'profile.busy', 'profile.busy');
    // the new profile can only be read from the server: with no connection nothing changes, the current one stays usable
    await api.get('/api/profiles');
  }
  if (book?.engine !== null) {
    // a guest (engine null) has no server to tell
    api.setProfileId(id);
    const store = await getStorage();
    await store.set(PROFILE_STORE_KEY, id);
    await store.remove('snapshot'); // the offline copy of the previous profile
  }
  if (Platform.OS !== 'web') {
    try {
      await (await openLocalDb()).run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', CURRENT_PROFILE_KEY, id);
    } catch (e) {
      if (book) throw e; // without a device book the server path above is all that matters
    }
  }
  resetLocalBook();
  await queryClient.resetQueries();
}

/** The server refuses an edit made over a newer one, so the current revision is read right before it. */
async function patchOnServer(id: string, patch: { name?: string; isArchived?: boolean }): Promise<void> {
  const row = (await api.get<ServerProfile[]>('/api/profiles')).find((r) => r.id === id);
  if (!row) throw new ApiError(404, 'profile.not_found', 'Profile not found.');
  await api.patch(`/api/profiles/${id}`, { ...patch, revision: row.revision });
}

export async function renameProfile(id: string, name: string): Promise<void> {
  const opening = currentBook();
  const book = opening && (await opening);
  if (book && !book.engine) await book.db.run('UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?', name, new Date().toISOString(), id);
  else await patchOnServer(id, { name });
  await queryClient.invalidateQueries({ queryKey: ['profiles'] });
}

/**
 * Deleting a profile hides it (archive): no record is erased. The last profile cannot go, operations not yet sent keep
 * it until they are delivered, and when the profile on screen goes the next one opens first.
 */
export async function removeProfile(id: string): Promise<void> {
  const list = await loadProfiles();
  const next = list.items.find((x) => x.id !== id);
  if (!next) throw new ApiError(409, 'profile.last_active', 'profile.last_active');
  const opening = currentBook();
  const book = opening && (await opening);
  if (book?.engine) {
    const waiting = await book.db.first<{ n: number }>("SELECT count(*) AS n FROM sync_outbox WHERE profile_id = ? AND status = 'pending'", id);
    if (waiting?.n) throw new ApiError(409, 'profile.busy', 'profile.busy');
  }
  if (list.currentId === id) await selectProfile(next.id);
  if (book && !book.engine) await book.db.run('UPDATE profiles SET is_archived = 1, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
  else await patchOnServer(id, { isArchived: true });
  await queryClient.invalidateQueries({ queryKey: ['profiles'] });
}

export type StartOverScope = 'all' | 'operations';

/**
 * "Delete data" of the profile on screen. The old profile is hidden, not erased, so a wrong tap can be undone from the
 * database and no history is rewritten: a fresh profile with the same name opens in its place. It gets the default
 * catalog ('all'), or a copy of the wallets at zero, categories, sources, projects and people ('operations'). The fresh
 * one is finished before anything changes: if the copy fails, the current profile stays as it was.
 */
export async function startOver(scope: StartOverScope): Promise<void> {
  const list = await loadProfiles();
  const cur = list.items.find((x) => x.id === list.currentId);
  if (!cur) throw new ApiError(404, 'profile.not_found', 'Profile not found.');
  const opening = currentBook();
  const book = opening && (await opening);
  if (!book && useQueue.getState().pending.length > 0) throw new ApiError(409, 'profile.busy', 'profile.busy');
  if (book?.engine) {
    const waiting = await book.db.first<{ n: number }>("SELECT count(*) AS n FROM sync_outbox WHERE profile_id = ? AND status = 'pending'", cur.id);
    if (waiting?.n) throw new ApiError(409, 'profile.busy', 'profile.busy');
  }

  if (book && !book.engine) {
    const g = await book.ledger.guestBook();
    if (!g) throw new ApiError(404, 'profile.not_found', 'Profile not found.');
    const old = scope === 'operations' ? await localSnapshot(book) : null;
    const fresh = await book.ledger.createProfile(g.accountId, cur.name, cur.baseCurrency, scope === 'all');
    if (old) {
      const ids = new Map<string, string>();
      const categories = old.categories.filter((c) => !c.isArchived);
      for (const c of [...categories.filter((x) => !x.parentId), ...categories.filter((x) => x.parentId)])
        ids.set(c.id, await book.ledger.createCategory(fresh, { name: c.name, icon: c.icon, color: c.color, parentId: c.parentId ? ids.get(c.parentId) ?? null : null }));
      for (const s of old.incomeSources.filter((x) => !x.isArchived)) await book.ledger.createSource(fresh, { name: s.name, icon: s.icon, color: s.color });
      for (const w of old.wallets.filter((x) => !x.isArchived))
        await book.ledger.createWallet(fresh, { name: w.name, currency: w.currency, type: w.type, icon: w.icon, color: w.color, allowOverdraft: w.allowOverdraft });
    }
    await selectProfile(fresh);
    await book.db.run('UPDATE profiles SET is_archived = 1, updated_at = ? WHERE id = ?', new Date().toISOString(), cur.id);
    await queryClient.invalidateQueries({ queryKey: ['profiles'] });
    return;
  }

  const old = scope === 'operations' ? await api.get<Snapshot>('/api/sync/pull') : null;
  const fresh = await api.post<ServerProfile>('/api/profiles', {
    name: cur.name, baseCurrency: cur.baseCurrency, color: cur.color, icon: cur.icon, seedDefaults: scope === 'all',
  });
  try {
    if (old) {
      const add = (path: string, body: unknown) => api.request<{ id: string }>('POST', path, { body, headers: { 'X-Profile-Id': fresh.id } });
      const ids = new Map<string, string>();
      const categories = old.categories.filter((c) => !c.isArchived);
      for (const c of [...categories.filter((x) => !x.parentId), ...categories.filter((x) => x.parentId)]) {
        const made = await add('/api/categories', {
          name: c.name, icon: c.icon, color: c.color, parentId: c.parentId ? ids.get(c.parentId) ?? null : null,
          monthlyLimit: c.monthlyLimit ?? null, limitCurrency: c.limitCurrency ?? null,
        });
        ids.set(c.id, made.id);
      }
      for (const s of old.incomeSources.filter((x) => !x.isArchived)) await add('/api/income-sources', { name: s.name, icon: s.icon, color: s.color });
      for (const w of old.wallets.filter((x) => !x.isArchived)) {
        await add('/api/wallets', {
          name: w.name, type: w.type, currency: w.currency, initialBalance: 0, icon: w.icon, color: w.color,
          bankName: w.bankName ?? null, maskedNumber: w.maskedNumber ?? null, note: w.note ?? null, allowOverdraft: w.allowOverdraft,
        });
      }
      for (const x of (old.projects ?? []).filter((y) => !y.isArchived)) await add('/api/projects', { name: x.name, icon: x.icon, color: x.color, currency: x.currency, note: x.note ?? null });
      for (const x of old.people ?? []) await add('/api/people', { name: x.name, phone: x.phone ?? null, note: x.note ?? null });
    }
  } catch (e) {
    await patchOnServer(fresh.id, { isArchived: true }).catch(() => undefined);
    throw e;
  }
  await selectProfile(fresh.id);
  await patchOnServer(cur.id, { isArchived: true });
  await queryClient.invalidateQueries({ queryKey: ['profiles'] });
}

/** A guest's new profile lives on the device; an account's is made by the server (with the default catalog). */
export async function createProfile(name: string, baseCurrency: string): Promise<void> {
  const opening = currentBook();
  const book = opening && (await opening);
  if (book && !book.engine) {
    const g = await book.ledger.guestBook();
    if (g) await book.ledger.createProfile(g.accountId, name, baseCurrency);
  } else {
    await api.post('/api/profiles', { name, baseCurrency });
  }
  await queryClient.invalidateQueries({ queryKey: ['profiles'] });
}
