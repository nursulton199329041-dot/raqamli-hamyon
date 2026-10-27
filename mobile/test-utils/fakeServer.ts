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
export const category = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  id, name, icon: 'utilities', color: '#EF4444', isArchived: false, sortOrder: 0, ...extra,
});
export const source = (id: string, name: string): IncomeSource => ({ id, name, icon: 'salary', color: '#22C55E', isArchived: false, sortOrder: 0 });

interface PushOp { clientOperationId: string; kind: string; payload: Record<string, unknown> }
type Body = Record<string, unknown>;

/**
 * A tiny stand-in for the backend that implements just the endpoints the mobile client uses, with real ledger
 * semantics (balances change only when an operation is pushed and accepted; edits are reversal + new entry; reversals
 * restore balances). It replaces the network layer (`api.get/post/put/patch`) so the real stores, React Query cache and
 * components run unmodified. Numbers are integers/2-decimals in tests so float noise cannot hide a bug.
 */
export class FakeServer {
  wallets: Wallet[] = [];
  categories: Category[] = [];
  sources: IncomeSource[] = [];
  txs: Tx[] = [];
  pushes: PushOp[] = [];
  puts: { path: string; body: Body }[] = [];
  reversed: string[] = [];
  created: unknown[] = [];
  /** simulate a network outage: every call throws a network ApiError */
  offline = false;
  /** artificial latency (ms) for double-tap / slow network tests */
  latency = 0;
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  snapshot(): Snapshot {
    return {
      cursor: 'c', hasMore: false, transactions: this.txs.map((t) => ({ ...t })), wallets: this.wallets.map((w) => ({ ...w })),
      categories: this.categories, incomeSources: this.sources, people: [], projects: [], debts: [],
    };
  }

  private live = (t: Tx) => !t.reversedById && t.type !== 9;

  private breakdown(by: string, type: number): BreakdownRow[] {
    const key = by === 'source' ? 'incomeSourceId' : 'categoryId';
    const acc = new Map<string, number>();
    for (const t of this.txs) {
      const id = (t as unknown as Record<string, string | null | undefined>)[key];
      if (this.live(t) && t.type === type && id) acc.set(id, (acc.get(id) ?? 0) + t.amount);
    }
    return [...acc].map(([id, total]) => ({ id, name: id, currency: 'UZS', total, percent: 0, count: 1 }));
  }

  /** daily income/expense buckets from the same ledger rows the summary uses */
  private timeseries() {
    const by = new Map<string, { currency: string; day: string; income: number; expense: number }>();
    for (const t of this.txs) {
      if (!this.live(t) || (t.type !== 1 && t.type !== 2)) continue;
      const day = t.occurredAt.slice(0, 10);
      const k = `${t.currency}|${day}`;
      const row = by.get(k) ?? { currency: t.currency, day, income: 0, expense: 0 };
      if (t.type === 1) row.income += t.amount;
      else row.expense += t.amount;
      by.set(k, row);
    }
    return [...by.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map((r) => ({ period: r.day, start: `${r.day}T00:00:00Z`, currency: r.currency, income: r.income, expense: r.expense }));
  }

  private summary(from?: string, to?: string) {
    const by = new Map<string, { income: number; expense: number }>();
    for (const t of this.txs) {
      if (!this.live(t)) continue;
      if (from && t.occurredAt < from) continue;
      if (to && t.occurredAt > to) continue;
      const row = by.get(t.currency) ?? { income: 0, expense: 0 };
      if (t.type === 1) row.income += t.amount;
      if (t.type === 2) row.expense += t.amount;
      by.set(t.currency, row);
    }
    return {
      totals: [...by].map(([currency, r]) => ({
        currency, income: r.income, expense: r.expense, netFlow: r.income - r.expense, borrowed: 0, lent: 0, debtRepaid: 0, debtCollected: 0,
      })),
      debts: [],
    };
  }

  private w(id: unknown) {
    return this.wallets.find((x) => x.id === id);
  }

  private apply(op: PushOp, replacesId?: string): { status: 'applied' | 'rejected'; message?: string } {
    const p = op.payload;
    const amount = Number(p.amount);
    const common = {
      id: this.id('tx'), occurredAt: String(p.occurredAt ?? new Date().toISOString()), createdAt: new Date().toISOString(), amount,
      memo: (p.memo as string | null) ?? null, projectId: (p.projectId as string | null) ?? null, replacesId: replacesId ?? null,
    };
    switch (op.kind) {
      case 'income': {
        const to = this.w(p.walletId);
        if (!to) return { status: 'rejected', message: 'Wallet not found' };
        to.balance += amount;
        this.txs.push({ ...common, type: 1, currency: to.currency, walletId: to.id, incomeSourceId: (p.incomeSourceId as string | null) ?? null,
          personId: (p.personId as string | null) ?? null, reason: (p.reason as string | null) ?? null });
        return { status: 'applied' };
      }
      case 'expense': {
        const from = this.w(p.walletId);
        if (!from) return { status: 'rejected', message: 'Wallet not found' };
        if (!from.allowOverdraft && from.balance < amount) return { status: 'rejected', message: 'Insufficient funds' };
        from.balance -= amount;
        this.txs.push({ ...common, type: 2, currency: from.currency, walletId: from.id, categoryId: String(p.categoryId), personId: (p.personId as string | null) ?? null });
        return { status: 'applied' };
      }
      case 'transfer': {
        const from = this.w(p.fromWalletId);
        const to = this.w(p.toWalletId);
        if (!from || !to) return { status: 'rejected', message: 'Wallet not found' };
        if (from.id === to.id) return { status: 'rejected', message: 'Same wallet' };
        if (!from.allowOverdraft && from.balance < amount) return { status: 'rejected', message: 'Insufficient funds' };
        const cross = from.currency !== to.currency;
        if (cross && (p.toAmount === null || p.toAmount === undefined) && !p.fxRate) return { status: 'rejected', message: 'Different currencies: provide toAmount or fxRate.' };
        const received = cross ? Number(p.toAmount ?? amount * Number(p.fxRate)) : amount;
        from.balance -= amount;
        to.balance += received;
        this.txs.push({ ...common, type: 3, currency: from.currency, walletId: from.id, toWalletId: to.id, toAmount: received, toCurrency: to.currency,
          fxRate: cross ? Math.round((received / amount) * 1e6) / 1e6 : null });
        return { status: 'applied' };
      }
      case 'debt': {
        const target = this.w(p.walletId);
        if (!target) return { status: 'rejected', message: 'Wallet not found' };
        target.balance += p.direction === 0 ? amount : -amount;
        this.txs.push({ ...common, type: p.direction === 0 ? 4 : 5, currency: target.currency, walletId: target.id });
        return { status: 'applied' };
      }
      default:
        return { status: 'rejected', message: `unsupported ${op.kind}` };
    }
  }

  /** Posts a reversal entry that undoes the balances of `tx` and links both entries. */
  reverse(id: string): Tx {
    const tx = this.txs.find((t) => t.id === id);
    if (!tx) throw new ApiError(404, 'not_found', 'Transaction');
    if (tx.reversedById) throw new ApiError(422, 'tx.already_reversed', 'Already reversed');
    const sign = tx.type === 1 || tx.type === 4 ? -1 : 1; // undo: income/borrow remove money, expense/lend give it back
    if (tx.type === 3) {
      this.w(tx.walletId)!.balance += tx.amount;
      this.w(tx.toWalletId)!.balance -= tx.toAmount ?? tx.amount;
    } else {
      const w = this.w(tx.walletId)!;
      w.balance += sign * tx.amount;
    }
    const rev: Tx = {
      id: this.id('rev'), type: 9, occurredAt: new Date().toISOString(), amount: tx.amount, currency: tx.currency, walletId: tx.walletId,
      reversalOfId: tx.id, createdAt: new Date().toISOString(),
    };
    tx.reversedById = rev.id;
    this.txs.push(rev);
    this.reversed.push(id);
    return rev;
  }

  private list(q: Record<string, unknown>) {
    let items = this.txs.filter((t) => (t.type === 9 ? true : true));
    if (q.from) items = items.filter((t) => t.occurredAt >= String(q.from));
    if (q.to) items = items.filter((t) => t.occurredAt <= String(q.to));
    if (q.type !== undefined) items = items.filter((t) => t.type === Number(q.type));
    if (q.walletId) items = items.filter((t) => t.walletId === q.walletId || t.toWalletId === q.walletId);
    if (q.q) items = items.filter((t) => (t.memo ?? '').toLowerCase().includes(String(q.q).toLowerCase()));
    items = [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
    return { items, total: items.length, page: 1, pageSize: 100 };
  }

  private async gate() {
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    if (this.offline) throw new ApiError(0, 'network', 'Server bilan aloqa yo‘q');
  }

  install(): () => void {
    __setStorageForTests(memStorage());
    useQueue.setState({ pending: [], online: true, syncing: false });
    queryClient.clear();
    const get = jest.spyOn(api, 'get').mockImplementation((async (path: string, q?: Record<string, unknown>) => {
      await this.gate();
      if (path === '/api/sync/pull') return this.snapshot();
      if (path === '/api/analytics/breakdown') return this.breakdown(String(q?.by), Number(q?.type ?? 2));
      if (path === '/api/analytics/budgets') return [];
      if (path === '/api/analytics/timeseries') return this.timeseries();
      if (path === '/api/analytics/summary') return this.summary(q?.from as string | undefined, q?.to as string | undefined);
      if (path === '/api/transactions') return this.list(q ?? {});
      throw new ApiError(404, 'not_found', `GET ${path}`);
    }) as never);
    const post = jest.spyOn(api, 'post').mockImplementation((async (path: string, body?: Body) => {
      await this.gate();
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
      if (path === '/api/categories') {
        const b = body as { name: string; icon: string; color: string; parentId?: string };
        const c = category(this.id('c'), b.name, { icon: b.icon, color: b.color, parentId: b.parentId ?? null });
        this.categories.push(c);
        this.created.push(c);
        return { ...c };
      }
      if (path === '/api/people') return { id: this.id('p') };
      const rev = /^\/api\/transactions\/([^/]+)\/reverse$/.exec(path);
      if (rev) return { transaction: this.reverse(rev[1]!) };
      throw new ApiError(404, 'not_found', `POST ${path}`);
    }) as never);
    const put = jest.spyOn(api, 'put').mockImplementation((async (path: string, body: Body) => {
      await this.gate();
      this.puts.push({ path, body });
      const m = /^\/api\/transactions\/([^/]+)\/(income|expense|transfer)$/.exec(path);
      if (!m) throw new ApiError(404, 'not_found', `PUT ${path}`);
      const old = this.txs.find((t) => t.id === m[1]);
      if (!old) throw new ApiError(404, 'not_found', 'Transaction');
      // correction = reversal + new entry, atomically: a rejected correction leaves the ledger untouched
      const before = { wallets: this.wallets.map((w) => ({ ...w })), txs: this.txs.map((x) => ({ ...x })), reversed: [...this.reversed] };
      this.reverse(old.id);
      const r = this.apply({ clientOperationId: 'put', kind: m[2]!, payload: body }, old.id);
      if (r.status === 'rejected') {
        this.wallets = before.wallets;
        this.txs = before.txs;
        this.reversed = before.reversed;
        throw new ApiError(422, 'rejected', r.message ?? 'rejected');
      }
      return { transaction: this.txs[this.txs.length - 1] };
    }) as never);
    return () => {
      get.mockRestore();
      post.mockRestore();
      put.mockRestore();
    };
  }
}
