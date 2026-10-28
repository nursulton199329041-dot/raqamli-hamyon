import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LedgerError, LocalLedger, DebtDirection, TxKind } from '@/local/ledger';
import { migrate, MigrationError } from '@/local/migrate';
import { convert, deriveRate, minorToDecimal, toMinor } from '@/local/money';
import { ledgerCheck, localSummary } from '@/local/reports';
import { MIGRATIONS } from '@/offline/migrations';
import { nodeDb } from '../test-utils/nodeDb';

const LATEST = MIGRATIONS.length;

async function fresh() {
  const db = nodeDb();
  await migrate(db);
  const ledger = new LocalLedger(db);
  const { accountId, profileId } = await ledger.ensureLocalAccount('Test');
  return { db, ledger, accountId, profileId };
}

const count = async (db: ReturnType<typeof nodeDb>, sql: string, ...p: (string | number)[]) =>
  (await db.first<{ n: number }>(sql, ...p))!.n;

describe('money in minor units (no floats; backend rounding)', () => {
  it('parses user text exactly and refuses extra precision', () => {
    expect(toMinor('1 500 000,50', 'UZS')).toBe(150_000_050);
    expect(toMinor('0.1', 'USD') + toMinor('0.2', 'USD')).toBe(toMinor('0.3', 'USD')); // 0.1 + 0.2 === 0.3 here
    expect(() => toMinor('1.005', 'USD')).toThrow(/fraction digits/);
    expect(() => toMinor('0', 'UZS')).toThrow(/greater than zero/);
    expect(() => toMinor('10000000000000', 'UZS')).toThrow(/too large/);
    expect(minorToDecimal(14_400_000, 'UZS')).toBe('144000');
  });

  it('converts and derives rates exactly like the server', () => {
    expect(convert(1_200, 'USD', '12000', 'UZS')).toBe(14_400_000); // 12 USD x 12 000 = 144 000.00 UZS
    expect(convert(115, 'USD', '12345.678', 'UZS')).toBe(1_419_753); // 14 197.5297 -> 14 197.53 (half away from zero)
    expect(deriveRate(300, 'USD', 3_700_000, 'UZS')).toBe('12333.33333333');
    expect(() => convert(1, 'UZS', '0.00000001', 'USD')).toThrow(/rounds to zero/);
  });
});

describe('local schema migrations (never lose data)', () => {
  it('a fresh database reaches the latest version with every ledger table', async () => {
    const db = nodeDb();
    expect(await migrate(db)).toBe(LATEST);
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','view')")).map((t) => t.name);
    for (const t of ['accounts', 'profiles', 'wallets', 'income_sources', 'categories', 'transactions', 'transaction_entries', 'debts',
      'debt_movements', 'currency_rates', 'sync_outbox', 'sync_checkpoints', 'schema_migrations', 'kv', 'ops'])
      expect(tables).toContain(t);
  });

  it('an old app database (v2: cached snapshot + unsent queue) is upgraded with its data intact', async () => {
    const db = nodeDb();
    await migrate(db, MIGRATIONS.slice(0, 2));
    await db.run('INSERT INTO kv (k, v) VALUES (?, ?)', 'snapshot', '{"wallets":[1]}');
    await db.run('INSERT INTO ops (id, seq, json) VALUES (?, ?, ?)', 'op-1', 0, '{"kind":"expense"}');
    expect(await migrate(db)).toBe(LATEST);
    expect(await db.first('SELECT v FROM kv WHERE k = ?', 'snapshot')).toEqual({ v: '{"wallets":[1]}' });
    expect(await count(db, 'SELECT count(*) AS n FROM ops')).toBe(1);
    expect(await migrate(db)).toBe(LATEST); // re-running is a no-op
  });

  it('a migration that fails half-way rolls back completely; the next start retries cleanly', async () => {
    const db = nodeDb();
    await migrate(db, MIGRATIONS.slice(0, 2));
    await db.run('INSERT INTO kv (k, v) VALUES (?, ?)', 'snapshot', 'keep me');
    const broken = [...MIGRATIONS.slice(0, 2), ['CREATE TABLE half_done (x INTEGER)', 'CREATE TABLE oops (']];
    await expect(migrate(db, broken)).rejects.toBeInstanceOf(MigrationError);
    expect((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(2);
    expect(await count(db, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'half_done'")).toBe(0);
    expect(await db.first('SELECT v FROM kv WHERE k = ?', 'snapshot')).toEqual({ v: 'keep me' });
    expect(await migrate(db)).toBe(LATEST);
  });

  it('a database written by a newer app version is opened as is, never rewritten', async () => {
    const db = nodeDb();
    await migrate(db);
    await db.exec(`PRAGMA user_version = ${LATEST + 5}`);
    expect(await migrate(db)).toBe(LATEST + 5);
  });

  it('data survives closing and reopening the database file (app restart / phone reboot)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hamyon-'));
    try {
      const file = join(dir, 'hamyon.db');
      let db = nodeDb(file);
      await migrate(db);
      let ledger = new LocalLedger(db);
      const { profileId } = await ledger.ensureLocalAccount();
      const w = await ledger.createWallet(profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 50_000_000 });
      const cat = (await db.first<{ id: string }>('SELECT id FROM categories WHERE profile_id = ?', profileId))!.id;
      await ledger.expense(profileId, { walletId: w.id, amountMinor: 1_250_000, categoryId: cat });
      db.close();

      db = nodeDb(file);
      expect(await migrate(db)).toBe(LATEST);
      ledger = new LocalLedger(db);
      expect((await ledger.ensureLocalAccount()).profileId).toBe(profileId); // same account, no second set of defaults
      expect((await ledger.wallet(profileId, w.id))!.balance_minor).toBe(48_750_000);
      expect(await count(db, "SELECT count(*) AS n FROM sync_outbox WHERE status = 'pending'")).toBe(2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('local ledger: every operation is one atomic SQLite transaction', () => {
  it('first start without a server: one local account, main profile, default categories and sources (idempotent)', async () => {
    const { db, ledger, profileId } = await fresh();
    expect((await ledger.ensureLocalAccount()).profileId).toBe(profileId);
    expect(await count(db, 'SELECT count(*) AS n FROM profiles')).toBe(1);
    expect(await count(db, 'SELECT count(*) AS n FROM categories WHERE profile_id = ?', profileId)).toBe(12);
    expect(await count(db, 'SELECT count(*) AS n FROM income_sources WHERE profile_id = ?', profileId)).toBe(3);
  });

  it('100 offline expenses: exact balance, 100 outbox entries with unique ids, books balance', async () => {
    const { db, ledger, profileId } = await fresh();
    const w = await ledger.createWallet(profileId, { name: 'Karta', currency: 'UZS', initialMinor: toMinor('1000000', 'UZS') });
    const cat = await ledger.createCategory(profileId, { name: 'Kafe' });
    for (let i = 0; i < 100; i += 1) await ledger.expense(profileId, { walletId: w.id, amountMinor: toMinor('1234.56', 'UZS'), categoryId: cat });
    expect((await ledger.wallet(profileId, w.id))!.balance_minor).toBe(100_000_000 - 100 * 123_456);
    const ops = await db.all<{ op_id: string; kind: string }>("SELECT op_id, kind FROM sync_outbox WHERE kind = 'expense'");
    expect(ops).toHaveLength(100);
    expect(new Set(ops.map((o) => o.op_id)).size).toBe(100);
    expect((await localSummary(db, profileId))[0]).toMatchObject({ currency: 'UZS', expense: 12_345_600, income: 0 });
    expect((await ledgerCheck(db, profileId)).ok).toBe(true);
  });

  it('the same operation sent twice (double tap / retry) is written once', async () => {
    const { db, ledger, profileId } = await fresh();
    const w = await ledger.createWallet(profileId, { name: 'Karta', currency: 'UZS', initialMinor: 10_000_00 });
    const cat = await ledger.createCategory(profileId, { name: 'X' });
    const a = await ledger.expense(profileId, { walletId: w.id, amountMinor: 5_00, categoryId: cat, opId: 'op-same' });
    const b = await ledger.expense(profileId, { walletId: w.id, amountMinor: 5_00, categoryId: cat, opId: 'op-same' });
    expect(b.replayed).toBe(true);
    expect(b.tx.id).toBe(a.tx.id);
    expect((await ledger.wallet(profileId, w.id))!.balance_minor).toBe(9_995_00);
    expect(await count(db, "SELECT count(*) AS n FROM sync_outbox WHERE op_id = 'op-same'")).toBe(1);
  });

  it('insufficient funds: nothing is written at all (no entry, no lines, no outbox, same balance)', async () => {
    const { db, ledger, profileId } = await fresh();
    const w = await ledger.createWallet(profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 100_00 });
    const cat = await ledger.createCategory(profileId, { name: 'X' });
    const before = await Promise.all(['transactions', 'transaction_entries', 'sync_outbox'].map((t) => count(db, `SELECT count(*) AS n FROM ${t}`)));
    await expect(ledger.expense(profileId, { walletId: w.id, amountMinor: 100_01, categoryId: cat })).rejects.toMatchObject({ code: 'wallet.insufficient_funds' });
    const after = await Promise.all(['transactions', 'transaction_entries', 'sync_outbox'].map((t) => count(db, `SELECT count(*) AS n FROM ${t}`)));
    expect(after).toEqual(before);
    expect((await ledger.wallet(profileId, w.id))!.balance_minor).toBe(100_00);
  });

  it('a failure in the LAST step (outbox write) rolls back the entry, its lines and the balance change', async () => {
    const { db, ledger, profileId } = await fresh();
    const w = await ledger.createWallet(profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 1_000_00 });
    const cat = await ledger.createCategory(profileId, { name: 'X' });
    await db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON sync_outbox WHEN NEW.kind = 'expense' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(ledger.expense(profileId, { walletId: w.id, amountMinor: 10_00, categoryId: cat })).rejects.toThrow(/disk full/);
    expect(await count(db, 'SELECT count(*) AS n FROM transactions WHERE type = ?', TxKind.Expense)).toBe(0);
    expect((await ledger.wallet(profileId, w.id))!.balance_minor).toBe(1_000_00);
    expect((await ledgerCheck(db, profileId)).ok).toBe(true);
  });

  it('USD wallet pays a UZS expense: wallet loses dollars, the expense counts 144 000 UZS, reversal restores it', async () => {
    const { db, ledger, profileId } = await fresh();
    const usd = await ledger.createWallet(profileId, { name: 'Dollar', currency: 'USD', initialMinor: 100_00 });
    const cat = await ledger.createCategory(profileId, { name: 'Kafe' });
    const op = await ledger.expense(profileId, { walletId: usd.id, amountMinor: 12_00, categoryId: cat, toCurrency: 'UZS', rate: '12000', rateDate: '2026-10-28' });
    expect(op.tx).toMatchObject({ amount_minor: 1200, currency: 'USD', to_amount_minor: 14_400_000, to_currency: 'UZS', fx_rate: '12000', rate_source: 'manual', rate_date: '2026-10-28' });
    expect((await ledger.wallet(profileId, usd.id))!.balance_minor).toBe(88_00);
    expect(await localSummary(db, profileId)).toEqual([expect.objectContaining({ currency: 'UZS', expense: 14_400_000 })]);
    const payload = JSON.parse((await db.first<{ payload: string }>('SELECT payload FROM sync_outbox WHERE op_id = ?', op.tx.idempotency_key))!.payload);
    expect(payload).toMatchObject({ amount: 12, toCurrency: 'UZS', toAmount: 144000 });
    expect((await ledgerCheck(db, profileId)).ok).toBe(true);

    const rev = await ledger.reverse(profileId, op.tx.id);
    expect(rev.tx.fx_rate).toBe('12000'); // stored rate is kept, never re-priced
    expect((await ledger.wallet(profileId, usd.id))!.balance_minor).toBe(100_00);
    expect(await localSummary(db, profileId)).toEqual([]);
    await expect(ledger.reverse(profileId, op.tx.id)).resolves.toMatchObject({ replayed: true });
  });

  it('transfers and debts never count as income or expense; repayments cannot exceed the debt', async () => {
    const { db, ledger, profileId } = await fresh();
    const cash = await ledger.createWallet(profileId, { name: 'Naqd', currency: 'UZS' });
    const card = await ledger.createWallet(profileId, { name: 'Karta', currency: 'UZS' });
    const usd = await ledger.createWallet(profileId, { name: 'Dollar', currency: 'USD' });
    const salary = await ledger.createSource(profileId, { name: 'Ish haqi' });
    await ledger.income(profileId, { walletId: cash.id, amountMinor: 5_000_000_00, sourceId: salary });
    await ledger.transfer(profileId, { fromWalletId: cash.id, toWalletId: card.id, amountMinor: 1_000_000_00 });
    const borrowed = await ledger.debt(profileId, { direction: DebtDirection.Borrowed, walletId: usd.id, amountMinor: 1_000_00, personName: 'Botir aka' });
    expect((await ledger.wallet(profileId, usd.id))!.balance_minor).toBe(1_000_00);

    let s = await localSummary(db, profileId);
    expect(s.find((x) => x.currency === 'UZS')).toMatchObject({ income: 5_000_000_00, expense: 0 });
    expect(s.find((x) => x.currency === 'USD')).toMatchObject({ income: 0, borrowed: 1_000_00 });

    await ledger.repay(profileId, borrowed.debtId, { walletId: usd.id, amountMinor: 400_00 });
    await expect(ledger.repay(profileId, borrowed.debtId, { walletId: usd.id, amountMinor: 600_01 })).rejects.toMatchObject({ code: 'debt.overpayment' });
    await expect(ledger.repay(profileId, borrowed.debtId, { walletId: cash.id, amountMinor: 1_00 })).rejects.toMatchObject({ code: 'debt.currency_mismatch' });
    expect(await db.first('SELECT outstanding_minor, status FROM debts WHERE id = ?', borrowed.debtId)).toEqual({ outstanding_minor: 600_00, status: 0 });
    s = await localSummary(db, profileId);
    expect(s.find((x) => x.currency === 'USD')).toMatchObject({ expense: 0, repaid: 400_00 });
    expect(await count(db, 'SELECT count(*) AS n FROM debt_movements WHERE debt_id = ?', borrowed.debtId)).toBe(2);
    expect((await ledgerCheck(db, profileId)).ok).toBe(true);
  });

  it('profiles are isolated: one profile cannot spend from or see another profile\'s wallet', async () => {
    const { ledger, accountId, profileId } = await fresh();
    const other = await ledger.createProfile(accountId, 'Oila');
    const w = await ledger.createWallet(profileId, { name: 'Shaxsiy', currency: 'UZS', initialMinor: 1_000_00 });
    const otherCat = await ledger.createCategory(other, { name: 'Oziq' });
    await expect(ledger.expense(other, { walletId: w.id, amountMinor: 1_00, categoryId: otherCat })).rejects.toBeInstanceOf(LedgerError);
    expect(await ledger.wallets(other)).toEqual([]);
    expect((await ledger.wallet(profileId, w.id))!.balance_minor).toBe(1_000_00);
  });

  it('a stale wallet edit (made from an older copy) is refused instead of overwriting', async () => {
    const { ledger, profileId } = await fresh();
    const w = await ledger.createWallet(profileId, { name: 'Naqd', currency: 'UZS' });
    await ledger.updateWallet(profileId, w.id, w.revision, { name: 'Naqd pul' });
    await expect(ledger.updateWallet(profileId, w.id, w.revision, { name: 'Eski' })).rejects.toMatchObject({ code: 'conflict.stale' });
    expect((await ledger.wallet(profileId, w.id))!.name).toBe('Naqd pul');
  });
});
