import { balance, breakdown, budgets, summary, timeSeries, transactions, walletPeriods } from '@/local/analytics';
import { applyUiOp, correctUiOp, type LocalBook } from '@/local/bridge';
import { DebtDirection, LedgerError, LocalLedger } from '@/local/ledger';
import { migrate } from '@/local/migrate';
import { ledgerCheck } from '@/local/reports';
import { nodeDb } from '../test-utils/nodeDb';

async function guest(): Promise<LocalBook> {
  const db = nodeDb();
  await migrate(db);
  const ledger = new LocalLedger(db, () => new Date('2026-10-28T08:00:00Z'));
  const { profileId } = await ledger.ensureLocalAccount();
  return { db, ledger, profileId, engine: null };
}

const n = async (b: LocalBook, sql: string, ...p: string[]) => (await b.db.first<{ n: number }>(sql, ...p))!.n;

describe('guest book ("start with a local account")', () => {
  it('works with no server; its default catalog waits in the outbox ahead of anything entered later', async () => {
    const b = await guest();
    const g = await b.ledger.guestBook();
    expect(g).toMatchObject({ empty: true, profiles: [{ id: b.profileId }] });
    const seeds = await n(b, "SELECT count(*) AS n FROM sync_outbox WHERE op_id LIKE 'seed:%'");
    expect(seeds).toBe(await n(b, 'SELECT (SELECT count(*) FROM categories) + (SELECT count(*) FROM income_sources) AS n'));

    const w = await b.ledger.createWallet(b.profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 100_000_00 });
    expect((await b.ledger.guestBook())!.empty).toBe(false);
    expect(await b.ledger.dropEmptyGuest()).toBe(false); // entered data is never dropped
    const order = await b.db.all<{ op_id: string }>('SELECT op_id FROM sync_outbox ORDER BY seq');
    expect(order.at(-1)!.op_id).toBe(`wallet:${w.id}`); // categories first, so the server knows them before any expense
  });

  it('an untouched guest book is removed on sign-in instead of becoming an empty extra profile', async () => {
    const b = await guest();
    expect(await b.ledger.dropEmptyGuest()).toBe(true);
    expect(await n(b, 'SELECT (SELECT count(*) FROM accounts) + (SELECT count(*) FROM profiles) + (SELECT count(*) FROM categories) + (SELECT count(*) FROM sync_outbox) AS n')).toBe(0);
    await b.ledger.adoptCloudAccount({ id: 'user-1' }, [{ id: 'srv-profile', name: 'Asosiy', baseCurrency: 'UZS' }]); // nothing in the way
  });

  it('linking keeps every row (same ids) under the account; another account can never take the book', async () => {
    const b = await guest();
    const w = await b.ledger.createWallet(b.profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 50_000_00 });
    await expect(b.ledger.adoptCloudAccount({ id: 'user-1' }, [])).rejects.toMatchObject({ code: 'identity.merge_required' });

    await b.ledger.linkGuest({ id: 'user-1', email: 'a@b.c' });
    await b.ledger.linkGuest({ id: 'user-1' }); // repeat is harmless
    expect(await b.ledger.guestBook()).toBeNull();
    await b.ledger.adoptCloudAccount({ id: 'user-1' }, [{ id: 'srv-main', name: 'Asosiy', baseCurrency: 'UZS' }]);
    expect(await n(b, 'SELECT count(*) AS n FROM profiles')).toBe(2); // the guest profile + the server's main one
    expect((await b.ledger.wallet(b.profileId, w.id))!.balance_minor).toBe(50_000_00);

    await expect(b.ledger.linkGuest({ id: 'user-2' })).rejects.toMatchObject({ code: 'identity.other_user' });
    await expect(b.ledger.adoptCloudAccount({ id: 'user-2' }, [])).rejects.toMatchObject({ code: 'identity.other_user' });
  });
});

describe('correcting a saved operation on the device', () => {
  it('reversal + corrected entry in one transaction; a refused correction changes nothing', async () => {
    const b = await guest();
    const w = await b.ledger.createWallet(b.profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 150_00 });
    const cat = (await b.db.first<{ id: string }>('SELECT id FROM categories LIMIT 1'))!.id;
    const first = await applyUiOp(b, 'expense', { walletId: w.id, amount: 100, categoryId: cat });

    await expect(correctUiOp(b, first.tx.id, 'expense', { walletId: w.id, amount: 500, categoryId: cat })).rejects.toBeInstanceOf(LedgerError);
    expect((await b.ledger.wallet(b.profileId, w.id))!.balance_minor).toBe(50_00);
    expect(await n(b, 'SELECT count(*) AS n FROM transactions WHERE reversed_by_id IS NOT NULL')).toBe(0);

    const fixed = await correctUiOp(b, first.tx.id, 'expense', { walletId: w.id, amount: 140, categoryId: cat });
    expect((await b.ledger.wallet(b.profileId, w.id))!.balance_minor).toBe(10_00);
    expect((await b.ledger.transaction(b.profileId, first.tx.id))!.reversed_by_id).not.toBeNull();
    expect(fixed.tx.amount_minor).toBe(140_00);
    expect((await ledgerCheck(b.db, b.profileId)).ok).toBe(true);
  });
});

describe('reports from the device book (same rules as the backend)', () => {
  async function sample() {
    const b = await guest();
    const p = b.profileId;
    const uzs = await b.ledger.createWallet(p, { name: 'Naqd', currency: 'UZS', initialMinor: 1_000_000_00 });
    const usd = await b.ledger.createWallet(p, { name: 'Dollar', currency: 'USD', initialMinor: 100_00 });
    const food = (await b.db.first<{ id: string }>('SELECT id FROM categories ORDER BY sort_order LIMIT 1'))!.id;
    const kafe = await b.ledger.createCategory(p, { name: 'Kafe', parentId: food });
    const other = (await b.db.first<{ id: string }>('SELECT id FROM categories WHERE parent_id IS NULL AND id NOT IN (?, ?) ORDER BY sort_order LIMIT 1', food, kafe))!.id;
    const src = (await b.db.first<{ id: string }>('SELECT id FROM income_sources LIMIT 1'))!.id;
    const at = (d: string) => `2026-10-${d}`;
    await b.ledger.income(p, { walletId: uzs.id, amountMinor: 500_000_00, sourceId: src, occurredAt: at('05T10:00:00Z') });
    await b.ledger.expense(p, { walletId: uzs.id, amountMinor: 60_000_00, categoryId: food, occurredAt: at('06T10:00:00Z'), memo: 'bozor' });
    await b.ledger.expense(p, { walletId: uzs.id, amountMinor: 40_000_00, categoryId: other, occurredAt: at('07T10:00:00Z') });
    // paid in dollars, spent in sums: counts 120 000 UZS, never as dollars
    await b.ledger.expense(p, { walletId: usd.id, amountMinor: 10_00, categoryId: kafe, toCurrency: 'UZS', rate: '12000', occurredAt: at('27T20:00:00Z') });
    const wrong = await b.ledger.expense(p, { walletId: uzs.id, amountMinor: 999_00, categoryId: food, occurredAt: at('08T10:00:00Z') });
    await b.ledger.reverse(p, wrong.tx.id);
    await b.ledger.transfer(p, { fromWalletId: uzs.id, toWalletId: usd.id, amountMinor: 121_000_00, toAmountMinor: 10_00, occurredAt: at('09T10:00:00Z') });
    await b.ledger.debt(p, { direction: DebtDirection.Lent, walletId: uzs.id, amountMinor: 200_000_00, personName: 'Ali', occurredAt: at('10T10:00:00Z') });
    return { b, p, uzs, usd, food, kafe, other };
  }
  const month = { from: '2026-09-30T19:00:00.000Z', to: '2026-10-31T18:59:59.999Z', tz: 300 };

  it('summary: income/expense per currency; transfers, openings, debts and reversed entries are not income or expense', async () => {
    const { b, p } = await sample();
    const s = await summary(b.db, p, month);
    expect(s.totals).toEqual([expect.objectContaining({ currency: 'UZS', income: 500_000, expense: 220_000, netFlow: 280_000, lent: 200_000, borrowed: 0 })]);
    expect(s.debts).toEqual([{ currency: 'UZS', iOwe: 0, owedToMe: 200_000 }]);
    expect(s.topExpenses![0]).toMatchObject({ amount: 120_000, currency: 'UZS', category: 'Kafe' });
  });

  it('breakdown and category filter (a parent includes its sub-categories)', async () => {
    const { b, p, food, other } = await sample();
    const rows = await breakdown(b.db, p, month, 'category');
    expect(rows.map((r) => [r.id === food ? 'food' : r.id === other ? 'other' : r.name, r.total, r.percent])).toEqual([
      ['Kafe', 120_000, 54.55], ['food', 60_000, 27.27], ['other', 40_000, 18.18],
    ]);
    const s = await summary(b.db, p, { ...month, categoryId: food });
    expect(s.totals[0]!.expense).toBe(180_000);
  });

  it('time series buckets follow the phone calendar (20:00 UTC on the 27th is the 28th in Tashkent) and fill gaps', async () => {
    const { b, p } = await sample();
    const days = await timeSeries(b.db, p, month, 'day');
    expect(days).toHaveLength(31);
    expect(days.find((d) => d.period === '2026-10-28')).toMatchObject({ expense: 120_000, start: '2026-10-28T00:00:00+05:00' });
    expect(days.find((d) => d.period === '2026-10-27')!.expense).toBe(0);
    const months = await timeSeries(b.db, p, month, 'month');
    expect(months).toEqual([expect.objectContaining({ period: '2026-10', income: 500_000, expense: 220_000 })]);
  });

  it('balance history and wallet periods come from the ledger lines and end at the wallet balances', async () => {
    const { b, p, uzs, usd } = await sample();
    const h = await balance(b.db, p, { ...month, from: '2026-10-01T00:00:00.000Z' }, 'month');
    const closing = Object.fromEntries(h.currencies.map((c) => [c.currency, c.closing]));
    expect(closing).toEqual({ UZS: Number((await b.ledger.wallet(p, uzs.id))!.balance_minor) / 100, USD: (await b.ledger.wallet(p, usd.id))!.balance_minor / 100 });
    // the opening balance is dated when the wallet was created (the 28th), so on the 6th only the income is there
    const wp = await walletPeriods(b.db, p, { from: '2026-10-06T00:00:00.000Z' });
    expect(wp.find((w) => w.walletId === uzs.id)).toMatchObject({ opening: 500_000, closing: 1_079_000 });
  });

  it('operations list: newest first, paged, text search; reversed ones only when asked', async () => {
    const { b, p } = await sample();
    const all = await transactions(b.db, p, { pageSize: 3 });
    expect(all.total).toBe(8); // 2 openings + income + 3 expenses + transfer + debt (the reversed pair left out)
    expect(all.items).toHaveLength(3);
    expect((await transactions(b.db, p, { includeReversed: true })).total).toBe(10);
    expect((await transactions(b.db, p, { q: 'BOZOR' })).items.map((t) => t.memo)).toEqual(['bozor']);
    expect((await transactions(b.db, p, { q: 'kafe' })).total).toBe(1); // matches the category name
  });

  it('budgets: this month, in the limit currency', async () => {
    const { b, p, food } = await sample();
    await b.db.run("UPDATE categories SET monthly_limit_minor = 50000000, limit_currency = 'UZS' WHERE id = ?", food);
    const [s] = await budgets(b.db, p, new Date('2026-10-28T08:00:00Z'));
    expect(s).toMatchObject({ categoryId: food, limit: 500_000, spent: 60_000, remaining: 440_000, percent: 12, exceeded: false });
  });
});
