import { ApiError } from '@/api/client';
import type { BreakdownRow, Category, IncomeSource, Snapshot, Tx, Wallet } from '@/api/types';
import { __setStorageForTests, type Storage } from '@/offline/storage';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';

/** In-memory storage so the offline queue / snapshot cache work without SQLite. */
export function memStorage(): Storage {
  const kv = new Map<string, string>();
  let ops: { id: string; json: string }[] = [];
  return {
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => void kv.set(k, v),
    remove: async (k) => void kv.delete(k),
    list: async () => ops.map((o) => o.json),
    replaceAll: async (items) => void (ops = items),
    logUpdate: async () => undefined,
    updateLog: async () => [],
    clearUserData: async () => void (ops = []),
  };
}

export const wallet = (id: string, name: string, balance: number, extra: Partial<Wallet> = {}): Wallet => ({
  id, name, type: 1, currency: 'UZS', balance, icon: 'card', color: '#3B82F6', allowOverdraft: false, isArchived: false, sortOrder: 0, ...extra,
});
export const category = (id: string, name: string): Category => ({ id, name, icon: 'utilities', color: '#EF4444', isArchived: false, sortOrder: 0 });
export const source = (id: string, name: string): IncomeSource => ({ id, name, icon: 'salary', color: '#22C55E', isArchived: false, sortOrder: 0 });

interface PushOp { clientOperationId: string; kind: string; payload: Record<string, unknown> }

/**
 * A tiny stand-in for the backend that implements just the endpoints the mobile client uses, with real ledger
 * semantics (balances change only when an operation is pushed and accepted). It replaces the network layer
 * (`api.get/post/patch`) so the real stores, React Query cache and components run unmodified.
 */
export class FakeServer {
  wallets: Wallet[] = [];
  categories: Category[] = [];
  sources: IncomeSource[] = [];
  txs: Tx[] = [];
  pushes: PushOp[] = [];
  created: unknown[] = [];
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  snapshot(): Snapshot {
    return {
      cursor: 'c', hasMore: false, transactions: [...this.txs], wallets: this.wallets.map((w) => ({ ...w })), categories: this.categories,
      incomeSources: this.sources, people: [], projects: [], debts: [],
    };
  }

  private breakdown(by: string, type: number): BreakdownRow[] {
    const key = by === 'source' ? 'incomeSourceId' : 'categoryId';
    const acc = new Map<string, number>();
    for (const t of this.txs) {
      const id = (t as unknown as Record<string, string | null | undefined>)[key];
      if (t.type === type && id) acc.set(id, (acc.get(id) ?? 0) + t.amount);
    }
    return [...acc].map(([id, total]) => ({ id, name: id, currency: 'UZS', total, percent: 0, count: 1 }));
  }

  private apply(op: PushOp): { status: 'applied' | 'rejected'; message?: string } {
    const p = op.payload;
    const w = (id: unknown) => this.wallets.find((x) => x.id === id);
    const amount = Number(p.amount);
    const base = { id: this.id('tx'), occurredAt: String(p.occurredAt ?? new Date().toISOString()), createdAt: new Date().toISOString(), amount, currency: 'UZS' };
    switch (op.kind) {
      case 'income': {
        const to = w(p.walletId);
        if (!to) return { status: 'rejected', message: 'Wallet not found' };
        to.balance += amount;
        this.txs.push({ ...base, type: 1, walletId: to.id, incomeSourceId: (p.incomeSourceId as string | null) ?? null });
        return { status: 'applied' };
      }
      case 'expense': {
        const from = w(p.walletId);
        if (!from) return { status: 'rejected', message: 'Wallet not found' };
        if (!from.allowOverdraft && from.balance < amount) return { status: 'rejected', message: 'Insufficient funds' };
        from.balance -= amount;
        this.txs.push({ ...base, type: 2, walletId: from.id, categoryId: String(p.categoryId) });
        return { status: 'applied' };
      }
      case 'transfer': {
        const from = w(p.fromWalletId);
        const to = w(p.toWalletId);
        if (!from || !to) return { status: 'rejected', message: 'Wallet not found' };
        if (from.id === to.id) return { status: 'rejected', message: 'Same wallet' };
        if (!from.allowOverdraft && from.balance < amount) return { status: 'rejected', message: 'Insufficient funds' };
        from.balance -= amount;
        to.balance += Number(p.toAmount ?? amount);
        this.txs.push({ ...base, type: 3, walletId: from.id, toWalletId: to.id });
        return { status: 'applied' };
      }
      case 'debt': {
        const target = w(p.walletId);
        if (!target) return { status: 'rejected', message: 'Wallet not found' };
        target.balance += p.direction === 0 ? amount : -amount;
        this.txs.push({ ...base, type: p.direction === 0 ? 4 : 5, walletId: target.id });
        return { status: 'applied' };
      }
      default:
        return { status: 'rejected', message: `unsupported ${op.kind}` };
    }
  }

  install(): () => void {
    __setStorageForTests(memStorage());
    useQueue.setState({ pending: [], online: true, syncing: false });
    queryClient.clear();
    const get = jest.spyOn(api, 'get').mockImplementation((async (path: string, q?: Record<string, unknown>) => {
      if (path === '/api/sync/pull') return this.snapshot();
      if (path === '/api/analytics/breakdown') return this.breakdown(String(q?.by), Number(q?.type ?? 2));
      if (path === '/api/analytics/budgets') return [];
      throw new ApiError(404, 'not_found', `GET ${path}`);
    }) as never);
    const post = jest.spyOn(api, 'post').mockImplementation((async (path: string, body?: Record<string, unknown>) => {
      if (path === '/api/sync/push') {
        const ops = (body?.operations ?? []) as PushOp[];
        this.pushes.push(...ops);
        return { results: ops.map((o) => ({ clientOperationId: o.clientOperationId, ...this.apply(o) })) };
      }
      if (path === '/api/wallets') {
        const b = body as { name: string; currency: string; initialBalance: number; icon: string; color: string; type: number };
        const w = wallet(this.id('w'), b.name, b.initialBalance, { currency: b.currency, icon: b.icon, color: b.color, type: b.type });
        this.wallets.push(w);
        this.created.push(w);
        return { ...w };
      }
      if (path === '/api/people') return { id: this.id('p') };
      throw new ApiError(404, 'not_found', `POST ${path}`);
    }) as never);
    return () => {
      get.mockRestore();
      post.mockRestore();
    };
  }
}
