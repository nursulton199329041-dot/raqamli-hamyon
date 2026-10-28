/**
 * Two devices + the REAL backend. Runs only when E2E_API points at a disposable API instance, e.g.
 *   E2E_API=http://127.0.0.1:5083 npx jest __tests__/syncE2E.test.ts
 * (never against a server holding real users: it registers throwaway accounts).
 */
import { ApiClient } from '@/api/client';
import type { AuthResponse, Wallet } from '@/api/types';
import { httpTransport } from '@/local/httpTransport';
import { DebtDirection, LocalLedger } from '@/local/ledger';
import { migrate } from '@/local/migrate';
import * as local from '@/local/analytics';
import { ledgerCheck } from '@/local/reports';
import { SyncEngine } from '@/local/sync';
import { nodeDb } from '../test-utils/nodeDb';
import { nodeFetch } from '../test-utils/nodeFetch';

const BASE = process.env.E2E_API;
const maybe = BASE ? describe : describe.skip;
if (BASE) globalThis.fetch = nodeFetch as unknown as typeof fetch;

async function signUp() {
  const api = new ApiClient(BASE!);
  const auth = await api.post<AuthResponse>('/api/auth/register', {
    email: `v6-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.test`, password: 'E2e-pass-1234', displayName: 'E2E', locale: 'uz',
  });
  api.setTokens({ access: auth.accessToken, refresh: auth.refreshToken });
  return { api, user: auth.user };
}

async function device(api: ApiClient, user: { id: string; email: string; displayName: string }) {
  const db = nodeDb();
  await migrate(db);
  const ledger = new LocalLedger(db);
  const profiles = await api.get<{ id: string; name: string; baseCurrency: string }[]>('/api/profiles');
  await ledger.adoptCloudAccount(user, profiles);
  const profileId = profiles[0]!.id;
  return { db, ledger, profileId, engine: new SyncEngine(db, httpTransport(api)) };
}

const serverWallets = async (api: ApiClient, profileId: string) =>
  api.request<Wallet[]>('GET', '/api/wallets', { headers: { 'X-Profile-Id': profileId } });

maybe('two devices against the real API', () => {
  jest.setTimeout(60_000);

  it('offline work on A reaches B exactly; conflicts are refused and undone; lost responses never duplicate', async () => {
    const { api, user } = await signUp();
    const A = await device(api, user);
    const B = await device(api, user);

    // first pull brings the server's default catalog to both devices
    expect((await A.engine.run(A.profileId)).error).toBeNull();
    const cats = await A.db.all<{ id: string }>('SELECT id FROM categories WHERE profile_id = ? AND parent_id IS NULL ORDER BY sort_order', A.profileId);
    expect(cats.length).toBeGreaterThan(5);

    // --- device A works offline: nothing reaches the server until sync
    const naqd = await A.ledger.createWallet(A.profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 1_000_000_00 });
    const usd = await A.ledger.createWallet(A.profileId, { name: 'Dollar', currency: 'USD', initialMinor: 100_00 });
    const kafe = await A.ledger.createCategory(A.profileId, { name: 'Qahva', parentId: cats[0]!.id });
    const src = await A.ledger.createSource(A.profileId, { name: 'Frilans' });
    await A.ledger.income(A.profileId, { walletId: naqd.id, amountMinor: 250_000_50, sourceId: src });
    const fx = await A.ledger.expense(A.profileId, { walletId: usd.id, amountMinor: 12_00, categoryId: kafe, toCurrency: 'UZS', rate: '12000' });
    const wrong = await A.ledger.expense(A.profileId, { walletId: naqd.id, amountMinor: 50_000_00, categoryId: kafe });
    await A.ledger.reverse(A.profileId, wrong.tx.id, 'xato');
    const debt = await A.ledger.debt(A.profileId, { direction: DebtDirection.Lent, walletId: naqd.id, amountMinor: 200_000_00, personName: 'Ali' });
    await A.ledger.repay(A.profileId, debt.debtId, { walletId: naqd.id, amountMinor: 50_000_00 });
    await A.ledger.transfer(A.profileId, { fromWalletId: usd.id, toWalletId: naqd.id, amountMinor: 10_00, rate: '12100' });
    expect(await serverWallets(api, A.profileId)).toEqual([]);

    const ra = await A.engine.run(A.profileId);
    expect(ra).toMatchObject({ rejected: 0, waiting: 0, drift: [], error: null });

    // server balances equal device A's, books reconcile on the server
    const srv = await serverWallets(api, A.profileId);
    const byId = new Map(srv.map((w) => [w.id, w.balance]));
    expect(byId.get(naqd.id)).toBe(1_000_000 + 250_000.5 - 200_000 + 50_000 + 121_000); // 1 221 000.50
    expect(byId.get(usd.id)).toBe(100 - 12 - 10);
    expect((await (await A.ledger.wallet(A.profileId, naqd.id))!).balance_minor).toBe(1_221_000_50);
    expect((await api.request<{ ok: boolean }>('GET', '/api/reconciliation', { headers: { 'X-Profile-Id': A.profileId } })).ok).toBe(true);
    const serverFx = (await api.request<{ items: { id: string; toAmount: number; toCurrency: string }[] }>('GET', '/api/transactions',
      { q: { pageSize: 100 }, headers: { 'X-Profile-Id': A.profileId } })).items.find((t) => t.id === fx.tx.id);
    expect(serverFx).toMatchObject({ toAmount: 144_000, toCurrency: 'UZS' });

    // --- device B receives everything exactly once, with the same ids
    const rb = await B.engine.run(B.profileId);
    expect(rb).toMatchObject({ drift: [], error: null });
    expect((await B.ledger.wallet(B.profileId, naqd.id))!.balance_minor).toBe(1_221_000_50);
    expect((await B.ledger.wallet(B.profileId, usd.id))!.balance_minor).toBe(78_00);
    expect((await B.ledger.transaction(B.profileId, wrong.tx.id))!.reversed_by_id).toBeTruthy();
    expect((await B.db.first<{ outstanding_minor: number }>('SELECT outstanding_minor FROM debts WHERE id = ?', debt.debtId))!.outstanding_minor).toBe(150_000_00);
    expect((await ledgerCheck(B.db, B.profileId)).ok).toBe(true);

    // --- conflict: both devices spend most of the same money while offline
    await A.ledger.expense(A.profileId, { walletId: naqd.id, amountMinor: 1_000_000_00, categoryId: kafe });
    const bSpend = await B.ledger.expense(B.profileId, { walletId: naqd.id, amountMinor: 1_000_000_00, categoryId: kafe });
    expect((await A.engine.run(A.profileId)).rejected).toBe(0);
    const rb2 = await B.engine.run(B.profileId);
    expect(rb2.rejected).toBe(1);
    expect(rb2.drift).toHaveLength(1); // B shows the refused spending until the user resolves it
    await B.ledger.discardRejected(B.profileId, bSpend.tx.idempotency_key);
    const rb3 = await B.engine.run(B.profileId);
    expect(rb3.drift).toEqual([]);
    expect((await B.ledger.wallet(B.profileId, naqd.id))!.balance_minor).toBe(221_000_50);
    expect((await serverWallets(api, A.profileId)).find((w) => w.id === naqd.id)!.balance).toBe(221_000.5);

    // --- lost responses: A believes nothing was delivered and sends everything again
    const before = (await api.request<{ items: unknown[] }>('GET', '/api/transactions', { q: { pageSize: 100, includeReversed: true }, headers: { 'X-Profile-Id': A.profileId } })).items.length;
    await A.db.run("UPDATE sync_outbox SET status = 'pending' WHERE status = 'done'");
    const replay = await A.engine.run(A.profileId);
    expect(replay).toMatchObject({ pushed: 0, rejected: 0, waiting: 0 });
    expect(replay.duplicates).toBeGreaterThan(5);
    const after = (await api.request<{ items: unknown[] }>('GET', '/api/transactions', { q: { pageSize: 100, includeReversed: true }, headers: { 'X-Profile-Id': A.profileId } })).items.length;
    expect(after).toBe(before);
    expect((await serverWallets(api, A.profileId)).find((w) => w.id === naqd.id)!.balance).toBe(221_000.5);
    expect((await ledgerCheck(A.db, A.profileId)).ok).toBe(true);
  });

  it('a guest book linked to a new account is uploaded once with the same ids, and its reports equal the server reports', async () => {
    const db = nodeDb();
    await migrate(db);
    const ledger = new LocalLedger(db);
    const { profileId: p } = await ledger.ensureLocalAccount();
    const food = (await db.first<{ id: string }>('SELECT id FROM categories ORDER BY sort_order LIMIT 1'))!.id;
    const src = (await db.first<{ id: string }>('SELECT id FROM income_sources LIMIT 1'))!.id;

    // weeks of work with no account and no server
    const naqd = await ledger.createWallet(p, { name: 'Naqd', currency: 'UZS', initialMinor: 1_000_000_00 });
    const usd = await ledger.createWallet(p, { name: 'Dollar', currency: 'USD', initialMinor: 100_00 });
    const kafe = await ledger.createCategory(p, { name: 'Kafe', parentId: food });
    await ledger.income(p, { walletId: naqd.id, amountMinor: 500_000_00, sourceId: src, occurredAt: '2026-10-05T10:00:00Z' });
    await ledger.expense(p, { walletId: naqd.id, amountMinor: 60_000_00, categoryId: food, occurredAt: '2026-10-06T10:00:00Z' });
    await ledger.expense(p, { walletId: usd.id, amountMinor: 10_00, categoryId: kafe, toCurrency: 'UZS', rate: '12000', occurredAt: '2026-10-27T20:00:00Z' });
    const wrong = await ledger.expense(p, { walletId: naqd.id, amountMinor: 999_00, categoryId: food, occurredAt: '2026-10-08T10:00:00Z' });
    await ledger.reverse(p, wrong.tx.id);
    await ledger.transfer(p, { fromWalletId: naqd.id, toWalletId: usd.id, amountMinor: 121_000_00, toAmountMinor: 10_00, occurredAt: '2026-10-09T10:00:00Z' });
    await ledger.debt(p, { direction: DebtDirection.Lent, walletId: naqd.id, amountMinor: 200_000_00, personName: 'Ali', occurredAt: '2026-10-10T10:00:00Z' });

    // sign up, then link: the server gets an empty profile with the device's id, the outbox fills it
    const { api, user } = await signUp();
    const guest = (await ledger.guestBook())!;
    for (const g of guest.profiles)
      for (let i = 0; i < 2; i++) // a lost response is simply repeated
        await api.post('/api/profiles', { id: g.id, name: g.name, baseCurrency: g.baseCurrency, seedDefaults: false });
    await ledger.linkGuest(user);
    const engine = new SyncEngine(db, httpTransport(api));
    expect(await engine.run(p)).toMatchObject({ rejected: 0, waiting: 0, drift: [], error: null });
    await db.run("UPDATE sync_outbox SET status = 'pending'"); // replay everything: the server must not duplicate
    expect(await engine.run(p)).toMatchObject({ pushed: 0, rejected: 0, drift: [], error: null });

    const h = { 'X-Profile-Id': p };
    const srvWallets = await serverWallets(api, p);
    expect(Object.fromEntries(srvWallets.map((w) => [w.id, w.balance]))).toEqual({ [naqd.id]: 1_119_000, [usd.id]: 100 });
    const profiles = await api.get<{ id: string }[]>('/api/profiles');
    expect(profiles.map((x) => x.id)).toContain(p);
    expect((await api.request<Wallet[]>('GET', '/api/wallets')).length).toBe(0); // the account's main profile is untouched

    const q = { from: '2026-09-30T19:00:00.000Z', to: '2026-10-31T18:59:59.999Z', tz: 300 };
    const get = <T>(path: string, extra: Record<string, string | number> = {}) => api.request<T>('GET', path, { q: { ...q, ...extra }, headers: h });
    const strip = <T extends object>(x: T) => JSON.parse(JSON.stringify(x)) as T;
    const srvSummary = await get<{ totals: unknown[]; debts: unknown[] }>('/api/analytics/summary');
    const mine = await local.summary(db, p, q);
    expect(mine.totals).toEqual(srvSummary.totals);
    expect(mine.debts).toEqual(srvSummary.debts);
    for (const by of ['category', 'wallet', 'source'])
      expect(await local.breakdown(db, p, q, by)).toEqual(await get('/api/analytics/breakdown', { by }));
    for (const g of ['day', 'week', 'month'])
      expect((await local.timeSeries(db, p, q, g)).map((x) => [x.period, x.currency, x.income, x.expense]))
        .toEqual((await get<{ period: string; currency: string; income: number; expense: number }[]>('/api/analytics/timeseries', { granularity: g }))
          .map((x) => [x.period, x.currency, x.income, x.expense]));
    const srvBal = await get<{ currencies: { currency: string; opening: number; closing: number; points: { period: string; balance: number }[] }[] }>('/api/analytics/balance', { granularity: 'week' });
    expect((await local.balance(db, p, q, 'week')).currencies.map((c) => ({ ...c, points: c.points.map((x) => [x.period, x.balance]) })))
      .toEqual(srvBal.currencies.map((c) => ({ ...c, points: c.points.map((x) => [x.period, x.balance]) })));
    expect(strip(await local.walletPeriods(db, p, q))).toEqual(await get('/api/analytics/wallets'));
    // same operations, newest first (entries with the very same time may come in either order)
    const mineTx = (await local.transactions(db, p, { ...q, pageSize: 100 })).items;
    const srvTx = (await get<{ items: { id: string; occurredAt: string }[] }>('/api/transactions', { pageSize: 100 })).items;
    expect(mineTx.map((t) => t.id).sort()).toEqual(srvTx.map((t) => t.id).sort());
    expect(mineTx.map((t) => Date.parse(t.occurredAt))).toEqual(srvTx.map((t) => Date.parse(t.occurredAt)));
  });
});
