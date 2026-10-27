import { errorText } from '@/api/errors';
import { create } from 'zustand';
import { ApiError } from '@/api/client';
import type { PendingOp } from '@/api/types';
import { newKey } from '@/lib/money';
import { getStorage } from '@/offline/storage';
import { api, queryClient } from './runtime';

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
    const list = get().pending.filter((o) => o.clientOperationId !== id);
    set({ pending: list });
    await persist(list);
  },
}));
