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
});
