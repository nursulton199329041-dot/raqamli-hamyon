import { Platform } from 'react-native';
import { errorText } from '@/api/errors';
import { create } from 'zustand';
import { ApiError } from '@/api/client';
import type { PendingOp, Snapshot } from '@/api/types';
import { applyUiOp, guestBook, localBook, localSnapshot, type LocalBook } from '@/local/bridge';
import { newKey } from '@/lib/money';
import { getStorage } from '@/offline/storage';
import { api, queryClient } from './runtime';
import { useSession } from './session';
import { useSettings } from './settings';

/**
 * The on-device book when the V6 beta is on (native, signed in). With the switch off this is null synchronously, so
 * the server path below runs exactly as before (no extra await).
 */
export function currentBook(): Promise<LocalBook | null> | null {
  if (Platform.OS === 'web') return null;
  const { user, status } = useSession.getState();
  if (status === 'guest') return guestBook();
  if (!useSettings.getState().localFirst || !user) return null;
  return localBook(user, true);
}

/** The user moved to another profile while this book was busy: its results must not reach the screens. */
async function switchedAway(book: LocalBook): Promise<boolean> {
  const opening = currentBook();
  const now = opening && (await opening);
  return !!now && now.profileId !== book.profileId;
}

interface PushResult {
  clientOperationId: string;
  status: 'applied' | 'duplicate' | 'rejected';
  errorCode?: string | null;
  message?: string | null;
}

export type SubmitOutcome = { ok: true; queued: boolean } | { ok: false; message: string };

interface QueueState {
  pending: PendingOp[];
  online: boolean;
  syncing: boolean;
  hydrated: boolean;
  hydrate(): Promise<void>;
  submit(kind: PendingOp['kind'], payload: Record<string, unknown>, targetId?: string): Promise<SubmitOutcome>;
  flush(): Promise<void>;
  dismiss(id: string): Promise<void>;
  setOnline(v: boolean): void;
  /** one background sync of the local book; refreshes the screens when the book changed */
  syncLocal(book: LocalBook): Promise<void>;
}

async function persist(list: PendingOp[]) {
  const s = await getStorage();
  await s.replaceAll(list.map((o) => ({ id: o.clientOperationId, json: JSON.stringify(o) })));
}

export const useQueue = create<QueueState>((set, get) => ({
  pending: [],
  online: true,
  syncing: false,
  hydrated: false,

  async hydrate() {
    try {
      const rows = await (await getStorage()).list();
      set({ pending: rows.map((r) => JSON.parse(r) as PendingOp), hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setOnline(v) {
    set({ online: v });
  },

  /**
   * Operations always go through /api/sync/push with a client operation id, so a retry after a lost response
   * can never create a duplicate. Network failure => persisted to the queue (pending); server rejection => error.
   */
  async submit(kind, payload, targetId) {
    const opening = currentBook();
    const book = opening && (await opening);
    if (book) {
      // offline-first: the operation is saved on the device (one transaction with its outbox row) and synced later
      try {
        await applyUiOp(book, kind, payload, targetId);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { ok: false, message: errorText(err.code, err.message ?? String(e)) };
      }
      void queryClient.invalidateQueries();
      void get().syncLocal(book);
      return { ok: true, queued: !get().online };
    }
    const id = newKey('op');
    const op: PendingOp = { clientOperationId: id, kind, payload, targetId: targetId ?? null, createdAt: new Date().toISOString() };
    try {
      const res = await api.post<{ results: PushResult[] }>('/api/sync/push', {
        operations: [{ clientOperationId: id, kind, payload, targetId: targetId ?? null }],
      });
      const r = res.results[0];
      if (r && r.status === 'rejected') return { ok: false, message: errorText(r.errorCode, r.message ?? r.errorCode ?? '') };
      set({ online: true });
      void queryClient.invalidateQueries();
      return { ok: true, queued: false };
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork) return { ok: false, message: e.message };
      const list = [...get().pending, op];
      set({ pending: list, online: false });
      await persist(list);
      return { ok: true, queued: true };
    }
  },

  async flush() {
    const opening = currentBook();
    const book = opening && (await opening);
    if (book) return get().syncLocal(book);
    const { pending, syncing } = get();
    if (syncing || pending.length === 0) return;
    const batch = pending.filter((o) => !o.error);
    if (batch.length === 0) return;
    set({ syncing: true });
    try {
      const res = await api.post<{ results: PushResult[] }>('/api/sync/push', {
        operations: batch.map((o) => ({
          clientOperationId: o.clientOperationId, kind: o.kind, payload: o.payload, targetId: o.targetId ?? null,
        })),
      });
      const byId = new Map(res.results.map((r) => [r.clientOperationId, r]));
      const remaining: PendingOp[] = [];
      for (const o of get().pending) {
        const r = byId.get(o.clientOperationId);
        if (!r) remaining.push(o);
        else if (r.status === 'rejected') remaining.push({ ...o, error: errorText(r.errorCode, r.message ?? r.errorCode ?? '') });
        // applied / duplicate => done, drop from queue
      }
      set({ pending: remaining, online: true });
      await persist(remaining);
      void queryClient.invalidateQueries();
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) set({ online: false });
    } finally {
      set({ syncing: false });
    }
  },

  async dismiss(id) {
    const opening = currentBook();
    const book = opening && (await opening);
    if (book) {
      // a refused operation is undone on the device so its balances match the server again
      await book.ledger.discardRejected(book.profileId, id);
      await get().syncLocal(book);
      return;
    }
    const list = get().pending.filter((o) => o.clientOperationId !== id);
    set({ pending: list });
    await persist(list);
  },

  async syncLocal(book) {
    set({ syncing: true });
    try {
      // a guest book has no server: nothing is sent, the screens are only refreshed
      const r = book.engine ? await book.engine.run(book.profileId) : null;
      const offline = !!r?.error && r.error !== 'sync.backoff';
      // what was entered in the other profiles is sent too, whichever one is on screen now
      if (book.engine && !r?.error) {
        const others = await book.db.all<{ profile_id: string }>(
          "SELECT DISTINCT profile_id FROM sync_outbox WHERE status = 'pending' AND profile_id <> ?", book.profileId);
        for (const o of others) await book.engine.run(o.profile_id);
      }
      if (await switchedAway(book)) return;
      const rows = !book.engine ? [] : await book.db.all<{ op_id: string; kind: string; payload: string; target_id: string | null; created_at: string; status: string; last_error: string | null }>(
        "SELECT op_id, kind, payload, target_id, created_at, status, last_error FROM sync_outbox WHERE profile_id = ? AND status IN ('pending', 'rejected') ORDER BY seq",
        book.profileId);
      set({
        online: !offline,
        pending: rows.map((o) => ({
          clientOperationId: o.op_id, kind: o.kind as PendingOp['kind'], payload: JSON.parse(o.payload) as Record<string, unknown>,
          targetId: o.target_id, createdAt: o.created_at, error: o.status === 'rejected' ? o.last_error : null,
        })),
      });
      const before = queryClient.getQueryData<Snapshot>(['snapshot']);
      const after = await localSnapshot(book);
      if (await switchedAway(book)) return;
      const strip = (s?: Snapshot) => (s ? JSON.stringify({ ...s, cursor: '' }) : '');
      if (strip(before) !== strip(after)) {
        queryClient.setQueryData(['snapshot'], after);
        void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'snapshot' });
      }
    } catch {
      /* the book stays as it is; the next trigger retries */
    } finally {
      set({ syncing: false });
    }
  },
}));
