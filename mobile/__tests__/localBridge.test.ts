import { applyUiOp, localBook, localSnapshot, type LocalBook } from '@/local/bridge';
import { LocalLedger, TxKind } from '@/local/ledger';
import { migrate } from '@/local/migrate';
import { ledgerCheck } from '@/local/reports';
import { SyncEngine } from '@/local/sync';
import { nodeDb } from '../test-utils/nodeDb';

const PROFILE = 'b2b2b2b2-0000-4000-8000-000000000002';
const PROJECT = 'c3c3c3c3-0000-4000-8000-000000000003';
const PERSON = 'd4d4d4d4-0000-4000-8000-000000000004';

async function book(): Promise<LocalBook> {
  const db = nodeDb();
  await migrate(db);
  const ledger = new LocalLedger(db);
  await ledger.adoptCloudAccount({ id: 'user-1' }, [{ id: PROFILE, name: 'Asosiy', baseCurrency: 'UZS' }]);
  await db.run("INSERT INTO people (id, profile_id, name, created_at) VALUES (?, ?, 'Vali', '2026-10-01T00:00:00Z')", PERSON, PROFILE);
  const engine = new SyncEngine(db, { push: async () => [], pull: async () => { throw new Error('offline'); } });
  return { db, ledger, engine, profileId: PROFILE };
}

describe('offline-first bridge: the operation sheet writes into the device book', () => {
  it('a dollar expense converted to sums: dollars leave the wallet, the sum is booked, both travel to the server', async () => {
    const b = await book();
    const usd = await b.ledger.createWallet(PROFILE, { name: 'Dollar', currency: 'USD', initialMinor: 100_00 });
    const cat = await b.ledger.createCategory(PROFILE, { name: 'Kafe' });

    await applyUiOp(b, 'expense', {
      walletId: usd.id, amount: 10, categoryId: cat, personId: null, memo: null, occurredAt: '2026-11-04T09:00:00.000Z', projectId: null,
      toCurrency: 'UZS', toAmount: 119_117.1, rateDate: '2026-11-04', rateSource: 'cbu',
    });

    const snap = await localSnapshot(b);
    expect(snap.wallets.find((w) => w.id === usd.id)!.balance).toBe(90);
    expect(snap.transactions.find((t) => t.type === TxKind.Expense)).toMatchObject({
      amount: 10, currency: 'USD', toAmount: 119_117.1, toCurrency: 'UZS', fxRate: 11911.71, rateDate: '2026-11-04', rateSource: 'cbu',
    });
    const out = await b.db.first<{ payload: string }>("SELECT payload FROM sync_outbox WHERE kind = 'expense'");
    expect(JSON.parse(out!.payload)).toMatchObject({ amount: 10, toCurrency: 'UZS', toAmount: 119117.1, rateDate: '2026-11-04', rateSource: 'cbu' });
    expect((await ledgerCheck(b.db, PROFILE)).ok).toBe(true);
  });

  it('UI payloads (decimal amounts) become exact book entries; the snapshot has the shapes the screens use', async () => {
    const b = await book();
    const naqd = await b.ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS', initialMinor: 1_000_000_00 });
    const usd = await b.ledger.createWallet(PROFILE, { name: 'Dollar', currency: 'USD', initialMinor: 100_00 });
    const cat = await b.ledger.createCategory(PROFILE, { name: 'Kafe' });
    const src = await b.ledger.createSource(PROFILE, { name: 'Ish' });
    const at = '2026-10-27T09:30:00.000Z';

    await applyUiOp(b, 'income', { walletId: naqd.id, amount: 250_000.5, incomeSourceId: src, personId: PERSON, reason: 'bonus', memo: 'oktabr', occurredAt: at, projectId: PROJECT });
    const exp = await applyUiOp(b, 'expense', { walletId: naqd.id, amount: 0.1, categoryId: cat, personId: null, memo: null, occurredAt: at, projectId: null });
    await applyUiOp(b, 'transfer', { fromWalletId: usd.id, toWalletId: naqd.id, amount: 10, toAmount: 121_000, fxRate: null, memo: null, occurredAt: at, projectId: null });
    const debt = await applyUiOp(b, 'debt', { direction: 1, personName: 'Ali', walletId: naqd.id, amount: 200_000, dueDate: null, reason: 'qarz', memo: null, occurredAt: at, projectId: null });
    await applyUiOp(b, 'repay', { walletId: naqd.id, amount: 50_000 }, debt.tx.debt_id);
    await applyUiOp(b, 'reverse', { memo: 'xato' }, exp.tx.id);

    const snap = await localSnapshot(b);
    const w = (id: string) => snap.wallets.find((x) => x.id === id)!;
    expect(w(naqd.id).balance).toBe(1_221_000.5); // 1 000 000 + 250 000.50 + 121 000 - 200 000 + 50 000 (expense reversed)
    expect(w(usd.id).balance).toBe(90);
    const inc = snap.transactions.find((t) => t.type === TxKind.Income)!;
    expect(inc).toMatchObject({ amount: 250_000.5, currency: 'UZS', personId: PERSON, reason: 'bonus', memo: 'oktabr', projectId: PROJECT, occurredAt: at });
    expect(snap.transactions.find((t) => t.id === exp.tx.id)).toMatchObject({ amount: 0.1, reversedById: expect.any(String) });
    expect(snap.transactions.find((t) => t.type === TxKind.Transfer)).toMatchObject({ amount: 10, toAmount: 121_000, toCurrency: 'UZS', fxRate: 12100 });
    expect(snap.debts).toEqual([expect.objectContaining({ direction: 1, principal: 200_000, outstanding: 150_000, currency: 'UZS' })]);
    expect(snap.people.map((x) => x.name).sort()).toEqual(['Ali', 'Vali']);
    expect(snap.categories.map((c) => c.name)).toEqual(['Kafe']);
    expect(snap.incomeSources.map((c) => c.name)).toEqual(['Ish']);
    expect((await ledgerCheck(b.db, PROFILE)).ok).toBe(true);

    // what the server will receive keeps person, reason and project
    const out = await b.db.first<{ payload: string }>("SELECT payload FROM sync_outbox WHERE kind = 'income'");
    expect(JSON.parse(out!.payload)).toMatchObject({ amount: 250_000.5, personId: PERSON, reason: 'bonus', projectId: PROJECT, id: inc.id });
  });

  it('refuses what the server would refuse, before anything is saved', async () => {
    const b = await book();
    const naqd = await b.ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS', initialMinor: 1_000_00 });
    const cat = await b.ledger.createCategory(PROFILE, { name: 'Kafe' });
    await expect(applyUiOp(b, 'expense', { walletId: naqd.id, amount: 5_000, categoryId: cat })).rejects.toMatchObject({ code: 'wallet.insufficient_funds' });
    await expect(applyUiOp(b, 'expense', { walletId: naqd.id, amount: 1.005, categoryId: cat })).rejects.toMatchObject({ code: 'amount.precision' });
    await expect(applyUiOp(b, 'expense', { walletId: 'nope', amount: 1, categoryId: cat })).rejects.toMatchObject({ code: 'not_found' });
    expect((await b.db.first<{ n: number }>("SELECT count(*) AS n FROM sync_outbox WHERE kind = 'expense'"))!.n).toBe(0);
  });

  it('stays off unless switched on, signed in and on a phone', async () => {
    await expect(localBook(null, true)).resolves.toBeNull();
    await expect(localBook({ id: 'u', email: '', displayName: '', locale: 'uz', defaultCurrency: 'UZS', theme: 'dark' }, false)).resolves.toBeNull();
  });
});
