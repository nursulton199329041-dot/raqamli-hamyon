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
    const acc = new Map<string, { total: number; count: number }>();
    for (const t of this.txs) {
      const id = (t as unknown as Record<string, string | null | undefined>)[key];
      if (!this.live(t) || t.type !== type || !id) continue;
      const a = acc.get(id) ?? { total: 0, count: 0 };
      acc.set(id, { total: a.total + t.amount, count: a.count + 1 });
    }
    return [...acc].map(([id, a]) => ({ id, name: id, currency: 'UZS', total: a.total, percent: 0, count: a.count }));
  }

  /** daily income/expense buckets from the same ledger rows the summary uses */
  private timeseries(q: Record<string, unknown> = {}) {
    const by = new Map<string, { currency: string; day: string; income: number; expense: number }>();
    for (const t of this.txs) {
      if (!this.live(t) || (t.type !== 1 && t.type !== 2)) continue;
      if (q.from && t.occurredAt < String(q.from)) continue;
      if (q.to && t.occurredAt > String(q.to)) continue;
      if (q.walletId && t.walletId !== q.walletId) continue;
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

  private summary(from?: string, to?: string, q: Record<string, unknown> = {}) {
    const by = new Map<string, { income: number; expense: number; d: number[] }>();
    for (const t of this.txs) {
      if (!this.live(t)) continue;
      if (from && t.occurredAt < from) continue;
      if (to && t.occurredAt > to) continue;
      if (q.walletId && t.walletId !== q.walletId && t.toWalletId !== q.walletId) continue;
      if (q.currency && t.currency !== q.currency) continue;
      if (t.type === 0 || t.type === 3 || t.type === 8) continue; // openings, transfers, adjustments are not activity
      const row = by.get(t.currency) ?? { income: 0, expense: 0, d: [0, 0, 0, 0] };
      if (t.type === 1) row.income += t.amount;
      if (t.type === 2) row.expense += t.amount;
      if (t.type >= 4 && t.type <= 7) row.d[t.type - 4]! += t.amount;
      by.set(t.currency, row);
    }
    return {
      totals: [...by].map(([currency, r]) => ({
        currency, income: r.income, expense: r.expense, netFlow: r.income - r.expense,
        borrowed: r.d[0]!, lent: r.d[1]!, debtRepaid: r.d[2]!, debtCollected: r.d[3]!,
      })),
      debts: this.debtPositions,
    };
  }

  /** open debt positions returned by the summary (tests set them directly) */
  debtPositions: { currency: string; iOwe: number; owedToMe: number }[] = [];

  /** signed effect of one operation on one wallet (the ledger lines the real server would post) */
  private delta(t: Tx, walletId: string): number {
    if (!this.live(t)) return 0;
    const out = t.walletId === walletId;
    const inn = t.toWalletId === walletId;
    switch (t.type) {
      case 0: case 1: case 4: case 7: return out ? t.amount : 0;
      case 2: case 5: case 6: return out ? -t.amount : 0;
      case 3: return (out ? -t.amount : 0) + (inn ? (t.toAmount ?? t.amount) : 0);
      default: return 0;
    }
  }

  /** balance of a wallet at instant `at` = current balance minus everything that happened after it */
  private balanceAt(walletId: string, at: string): number {
    const w = this.w(walletId);
    if (!w) return 0;
    return this.txs.filter((t) => t.occurredAt > at).reduce((b, t) => b - this.delta(t, walletId), w.balance);
  }

  private walletPeriods(q: Record<string, unknown>) {
    const to = String(q.to ?? new Date().toISOString());
    return this.wallets
      .filter((w) => (!q.walletId || w.id === q.walletId) && (!q.currency || w.currency === q.currency))
      .map((w) => ({
        walletId: w.id, name: w.name, currency: w.currency, isArchived: w.isArchived,
        opening: q.from ? this.balanceAt(w.id, new Date(new Date(String(q.from)).getTime() - 1).toISOString()) : 0,
        closing: this.balanceAt(w.id, to),
      }));
  }

  /** daily balance history per currency (local calendar days between from and to) */
  private balanceHistory(q: Record<string, unknown>) {
    const from = new Date(String(q.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString()));
    const to = new Date(String(q.to ?? new Date().toISOString()));
    const ws = this.wallets.filter((w) => (!q.walletId || w.id === q.walletId) && (!q.currency || w.currency === q.currency));
    const currencies = [...new Set(ws.map((w) => w.currency))].sort();
    const sumAt = (cur: string, at: Date) => ws.filter((w) => w.currency === cur).reduce((s, w) => s + this.balanceAt(w.id, at.toISOString()), 0);
    return {
      granularity: 'day', from: from.toISOString(), to: to.toISOString(),
      currencies: currencies.map((cur) => {
        const points = [];
        for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
          const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
          const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          points.push({ period, start: d.toISOString(), balance: sumAt(cur, end < to ? end : to) });
        }
        return { currency: cur, opening: sumAt(cur, new Date(from.getTime() - 1)), closing: sumAt(cur, to), points };
      }),
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
    if (q.currency) items = items.filter((t) => t.currency === q.currency || t.toCurrency === q.currency);
    if (q.categoryId) items = items.filter((t) => t.categoryId === q.categoryId || this.categories.some((c) => c.id === t.categoryId && c.parentId === q.categoryId));
    if (q.q) items = items.filter((t) => (t.memo ?? '').toLowerCase().includes(String(q.q).toLowerCase()));
    items = [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
    return { items, total: items.length, page: 1, pageSize: 100 };
  }

  private async gate() {
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    if (this.offline) throw new ApiError(0, 'network', 'Server bilan aloqa yo‘q');
  }

  profiles: { id: string; name: string; color: string; icon: string; baseCurrency: string; sortOrder: number; isArchived: boolean; revision: number; isCurrent: boolean }[] = [];
  /** what was created in a profile other than the current one */
  profileWrites: { path: string; profileId: string; id: string; body: Record<string, unknown> }[] = [];
  failProfileWrite: string | null = null;
  /** the profile each read was made in */
  profileHeaders: (string | null)[] = [];

  install(): () => void {
    __setStorageForTests(memStorage());
    useQueue.setState({ pending: [], online: true, syncing: false });
    queryClient.clear();
    const get = jest.spyOn(api, 'get').mockImplementation((async (path: string, q?: Record<string, unknown>) => {
      await this.gate();
      this.profileHeaders.push(api.getProfileId());
      if (path === '/api/profiles') return this.profiles;
      if (path === '/api/sync/pull') return this.snapshot();
      if (path === '/api/analytics/breakdown') return this.breakdown(String(q?.by), Number(q?.type ?? 2));
      if (path === '/api/analytics/budgets') return [];
      if (path === '/api/analytics/timeseries') return this.timeseries(q ?? {});
      if (path === '/api/analytics/summary') return this.summary(q?.from as string | undefined, q?.to as string | undefined, q ?? {});
      if (path === '/api/analytics/balance') return this.balanceHistory(q ?? {});
      if (path === '/api/analytics/wallets') return this.walletPeriods(q ?? {});
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
      if (path === '/api/profiles') {
        const b = body as { name: string; baseCurrency: string };
        const created = { id: this.id('pr'), name: b.name.trim(), color: '#4D8DFF', icon: 'person', baseCurrency: b.baseCurrency, sortOrder: this.profiles.length, isArchived: false, revision: 1, isCurrent: false };
        this.profiles.push(created);
        return created;
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
      const adjust = /^\/api\/wallets\/([^/]+)\/adjust$/.exec(path);
      if (adjust) {
        const w = this.wallets.find((x) => x.id === adjust[1]);
        if (!w) throw new ApiError(404, 'not_found', 'Wallet');
        w.balance = (body as { newBalance: number }).newBalance;
        return { transaction: null };
      }
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
    const realRequest = api.request.bind(api);
    const request = jest.spyOn(api, 'request').mockImplementation((async (method: string, path: string, opts: { body?: Record<string, unknown>; headers?: Record<string, string> } = {}) => {
      const profileId = opts.headers?.['X-Profile-Id'];
      if (method !== 'POST' || !profileId) return realRequest(method, path, opts as never);
      await this.gate();
      if (this.failProfileWrite === path) throw new ApiError(500, 'error', 'copy failed');
      const id = this.id('copy');
      this.profileWrites.push({ path, profileId, id, body: opts.body ?? {} });
      return { id };
    }) as never);
    const patch = jest.spyOn(api, 'patch').mockImplementation((async (path: string, body: { name?: string; isArchived?: boolean; revision: number }) => {
      await this.gate();
      const m = /^\/api\/profiles\/(.+)$/.exec(path);
      const row = m && this.profiles.find((x) => x.id === m[1]);
      if (!row) throw new ApiError(404, 'not_found', `PATCH ${path}`);
      if (row.revision !== body.revision) throw new ApiError(409, 'conflict.stale', 'stale');
      if (body.name) row.name = body.name;
      if (body.isArchived !== undefined) row.isArchived = body.isArchived;
      row.revision += 1;
      return { ...row };
    }) as never);
    return () => {
      request.mockRestore();
      patch.mockRestore();
      get.mockRestore();
      post.mockRestore();
      put.mockRestore();
    };
  }
}
