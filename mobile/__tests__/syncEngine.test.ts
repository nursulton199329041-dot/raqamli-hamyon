import type { Tx, Wallet } from '@/api/types';
import { NO_REF, uuid } from '@/local/ids';
import { AccountKind, LedgerError, LocalLedger, TxKind } from '@/local/ledger';
import { migrate } from '@/local/migrate';
import { ledgerCheck, localSummary } from '@/local/reports';
import { applyPull, backoffMs, SyncEngine, type PushOp, type PushResult, type RemotePull, type SyncTransport } from '@/local/sync';
import { nodeDb } from '../test-utils/nodeDb';

const USER = { id: 'a1a1a1a1-0000-4000-8000-000000000001', email: 'u@test', displayName: 'U' };
const PROFILE = 'b2b2b2b2-0000-4000-8000-000000000002';

async function cloud() {
  const db = nodeDb();
  await migrate(db);
  const ledger = new LocalLedger(db);
  await ledger.adoptCloudAccount(USER, [{ id: PROFILE, name: 'Asosiy', baseCurrency: 'UZS' }]);
  return { db, ledger };
}

/** Records what the engine sends; answers with a scripted function. */
class ScriptedTransport implements SyncTransport {
  pushes: PushOp[][] = [];
  pulls: (string | null)[] = [];
  answer: (op: PushOp) => PushResult['status'] | [PushResult['status'], string] = () => 'applied';
  fail: Error | null = null;
  page: RemotePull = emptyPull();

  async push(_profile: string, ops: PushOp[]): Promise<PushResult[]> {
    this.pushes.push(ops);
    if (this.fail) throw this.fail;
    return ops.map((o) => {
      const a = this.answer(o);
      const [status, code] = Array.isArray(a) ? a : [a, null];
      return { clientOperationId: o.clientOperationId, status, errorCode: code, message: code ? 'refused' : null };
    });
  }

  async pull(_profile: string, since: string | null): Promise<RemotePull> {
    this.pulls.push(since);
    return this.page;
  }
}

function emptyPull(): RemotePull {
  return { cursor: '2026-10-28T10:00:00.000Z', hasMore: false, transactions: [], lines: {}, wallets: [], categories: [], incomeSources: [], people: [], debts: [] };
}

const wallet = (id: string, balance: number, currency = 'UZS', name = 'Naqd'): Wallet => ({
  id, name, type: 0, currency, balance, icon: 'wallet', color: '#000', allowOverdraft: false, isArchived: false, sortOrder: 0,
});

const tx = (p: Partial<Tx> & Pick<Tx, 'id' | 'type' | 'amount' | 'currency'>): Tx => ({
  occurredAt: '2026-10-27T08:00:00.000Z', createdAt: '2026-10-27T08:00:01.000Z', ...p,
});

const balanceOf = async (ledger: LocalLedger, id: string) => (await ledger.wallet(PROFILE, id))!.balance_minor;
const outbox = (db: ReturnType<typeof nodeDb>) =>
  db.all<{ op_id: string; kind: string; status: string; attempts: number; next_attempt_at: string | null; last_error: string | null; payload: string }>(
    'SELECT * FROM sync_outbox ORDER BY seq');

describe('sync push: the outbox reaches the server in order, safely repeatable', () => {
  it('sends operations oldest first with the ids the device chose; applied and duplicate are done, rejected keeps its reason', async () => {
    const { db, ledger } = await cloud();
    const w = await ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS', initialMinor: 100_000_00 });
    const cat = await ledger.createCategory(PROFILE, { name: 'Kafe' });
    const e1 = await ledger.expense(PROFILE, { walletId: w.id, amountMinor: 30_000_00, categoryId: cat });
    const e2 = await ledger.expense(PROFILE, { walletId: w.id, amountMinor: 10_000_00, categoryId: cat });

    const t = new ScriptedTransport();
    t.answer = (o) => (o.clientOperationId === e2.tx.idempotency_key ? ['rejected', 'wallet.insufficient_funds'] : o.kind === 'category.create' ? 'duplicate' : 'applied');
    const report = await new SyncEngine(db, t).run(PROFILE);

    const sent = t.pushes[0]!;
    expect(sent.map((o) => o.kind)).toEqual(['wallet.create', 'category.create', 'expense', 'expense']);
    const opening = await db.first<{ id: string }>('SELECT id FROM transactions WHERE type = ?', TxKind.Opening);
    expect(sent[0]!.payload).toMatchObject({ id: w.id, openingId: opening!.id, initialBalance: 100_000 });
    expect(sent[2]!.payload).toMatchObject({ id: e1.tx.id, walletId: w.id, amount: 30_000, categoryId: cat });
    expect(report).toMatchObject({ pushed: 2, duplicates: 1, rejected: 1, waiting: 0, error: null });

    const rows = await outbox(db);
    expect(rows.map((r) => r.status)).toEqual(['done', 'done', 'done', 'rejected']);
    expect(rows[3]!.last_error).toMatch(/insufficient_funds/);

    // a second cycle sends nothing again
    await new SyncEngine(db, t).run(PROFILE);
    expect(t.pushes).toHaveLength(1);
  });

  it('network failure: nothing is lost, the batch backs off exponentially and is retried in the same order', async () => {
    const { db, ledger } = await cloud();
    let now = new Date('2026-10-28T09:00:00Z');
    const w = await ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS', initialMinor: 50_000_00 });
    await ledger.income(PROFILE, { walletId: w.id, amountMinor: 1_000_00 });

    const t = new ScriptedTransport();
    t.fail = new Error('network');
    const engine = new SyncEngine(db, t, () => now);
    const r1 = await engine.run(PROFILE);
    expect(r1.error).toBe('network');
    expect(r1.waiting).toBe(2);
    let rows = await outbox(db);
    expect(rows.every((r) => r.status === 'pending' && r.attempts === 1)).toBe(true);
    expect(rows[0]!.next_attempt_at).toBe(new Date(now.getTime() + backoffMs(1)).toISOString());

    // too early: the engine does not even call the server
    now = new Date(now.getTime() + 1000);
    expect((await engine.run(PROFILE)).error).toBe('sync.backoff');
    expect(t.pushes).toHaveLength(1);

    // second failure doubles the wait
    now = new Date(now.getTime() + backoffMs(1));
    await engine.run(PROFILE);
    rows = await outbox(db);
    expect(rows[0]!.attempts).toBe(2);
    expect(new Date(rows[0]!.next_attempt_at!).getTime() - now.getTime()).toBe(backoffMs(2));
    expect(backoffMs(2)).toBe(2 * backoffMs(1));
    expect(backoffMs(30)).toBe(3_600_000);

    // back online
    t.fail = null;
    now = new Date(now.getTime() + backoffMs(2));
    const ok = await engine.run(PROFILE);
    expect(ok).toMatchObject({ pushed: 2, waiting: 0, error: null });
    expect(t.pushes.at(-1)!.map((o) => o.kind)).toEqual(['wallet.create', 'income']);
  });

  it('two sync triggers at once share one cycle (no double send)', async () => {
    const { db, ledger } = await cloud();
    await ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS' });
    const t = new ScriptedTransport();
    const engine = new SyncEngine(db, t);
    await Promise.all([engine.run(PROFILE), engine.run(PROFILE), engine.run(PROFILE)]);
    expect(t.pushes).toHaveLength(1);
  });
});

describe('sync pull: server changes enter the book exactly once', () => {
  function serverPage() {
    const naqd = uuid();
    const usd = uuid();
    const cat = uuid();
    const sub = uuid();
    const src = uuid();
    const [open1, open2, inc, fx, exp, rev] = [uuid(), uuid(), uuid(), uuid(), uuid(), uuid()];
    const page: RemotePull = {
      ...emptyPull(),
      wallets: [wallet(naqd, 1_134_000), wallet(usd, 88, 'USD', 'Dollar')],
      categories: [{ id: sub, name: 'Qahva', icon: 'cup', color: '#111', parentId: cat, isArchived: false, sortOrder: 1 },
        { id: cat, name: 'Kafe', icon: 'tag', color: '#222', isArchived: false, sortOrder: 0 }],
      incomeSources: [{ id: src, name: 'Ish', icon: 'b', color: '#333', isArchived: false, sortOrder: 0 }],
      transactions: [
        tx({ id: open1, type: TxKind.Opening, amount: 1_000_000, currency: 'UZS', walletId: naqd, createdAt: '2026-10-27T08:00:00Z' }),
        tx({ id: open2, type: TxKind.Opening, amount: 100, currency: 'USD', walletId: usd, createdAt: '2026-10-27T08:00:01Z' }),
        tx({ id: inc, type: TxKind.Income, amount: 250_000.5, currency: 'UZS', walletId: naqd, incomeSourceId: src, createdAt: '2026-10-27T08:00:02Z' }),
        tx({ id: fx, type: TxKind.Expense, amount: 12, currency: 'USD', walletId: usd, toAmount: 144_000, toCurrency: 'UZS', fxRate: 12000,
          rateDate: '2026-10-27', rateSource: 'manual', categoryId: sub, createdAt: '2026-10-27T08:00:03Z' }),
        tx({ id: exp, type: TxKind.Expense, amount: 116_000.5, currency: 'UZS', walletId: naqd, categoryId: cat, createdAt: '2026-10-27T08:00:04Z', reversedById: rev }),
        tx({ id: rev, type: TxKind.Reversal, amount: 116_000.5, currency: 'UZS', walletId: naqd, categoryId: cat, reversalOfId: exp, createdAt: '2026-10-27T08:00:05Z' }),
      ],
      lines: {
        [open1]: [{ kind: AccountKind.Wallet, refId: naqd, currency: 'UZS', amount: 1_000_000 }, { kind: AccountKind.Equity, refId: NO_REF, currency: 'UZS', amount: -1_000_000 }],
        [open2]: [{ kind: AccountKind.Wallet, refId: usd, currency: 'USD', amount: 100 }, { kind: AccountKind.Equity, refId: NO_REF, currency: 'USD', amount: -100 }],
        [inc]: [{ kind: AccountKind.Wallet, refId: naqd, currency: 'UZS', amount: 250_000.5 }, { kind: AccountKind.IncomeSource, refId: src, currency: 'UZS', amount: -250_000.5 }],
        [fx]: [
          { kind: AccountKind.Wallet, refId: usd, currency: 'USD', amount: -12 }, { kind: AccountKind.FxClearing, refId: NO_REF, currency: 'USD', amount: 12 },
          { kind: AccountKind.FxClearing, refId: NO_REF, currency: 'UZS', amount: -144_000 }, { kind: AccountKind.ExpenseCategory, refId: sub, currency: 'UZS', amount: 144_000 },
        ],
        [exp]: [{ kind: AccountKind.Wallet, refId: naqd, currency: 'UZS', amount: -116_000.5 }, { kind: AccountKind.ExpenseCategory, refId: cat, currency: 'UZS', amount: 116_000.5 }],
        [rev]: [{ kind: AccountKind.Wallet, refId: naqd, currency: 'UZS', amount: 116_000.5 }, { kind: AccountKind.ExpenseCategory, refId: cat, currency: 'UZS', amount: -116_000.5 }],
      },
    };
    // 1 000 000 + 250 000.50 = 1 250 000.50 (the expense was reversed); USD 100 - 12 = 88
    page.wallets[0]!.balance = 1_250_000.5;
    return { page, naqd, usd, cat, sub, exp, rev };
  }

  it('a fresh device rebuilds balances, FX expense, reversal link and reports exactly; a repeated page changes nothing', async () => {
    const { db, ledger } = await cloud();
    const s = serverPage();
    const t = new ScriptedTransport();
    t.page = s.page;
    const engine = new SyncEngine(db, t);

    const r = await engine.run(PROFILE);
    expect(r).toMatchObject({ pulled: 6, drift: [], error: null });
    expect(t.pulls).toEqual([null]);
    expect(await balanceOf(ledger, s.naqd)).toBe(125_000_050);
    expect(await balanceOf(ledger, s.usd)).toBe(8_800);
    expect((await ledger.transaction(PROFILE, s.exp))!.reversed_by_id).toBe(s.rev);
    expect((await ledgerCheck(db, PROFILE)).ok).toBe(true);
    const uzs = (await localSummary(db, PROFILE)).find((x) => x.currency === 'UZS')!;
    expect(uzs).toMatchObject({ income: 25_000_050, expense: 14_400_000 }); // reversed expense excluded, FX counted in UZS
    const fxRow = await db.first<{ to_amount_minor: number; fx_rate: string; rate_source: string }>('SELECT * FROM transactions WHERE category_id = ? AND type = ?', s.sub, TxKind.Expense);
    expect(fxRow).toMatchObject({ to_amount_minor: 14_400_000, fx_rate: '12000', rate_source: 'manual' });

    // the next pull overlaps the cursor by 5 minutes; the same rows arrive again and are not added twice
    const again = await engine.run(PROFILE);
    expect(again.pulled).toBe(0);
    expect(t.pulls[1]).toBe('2026-10-28T09:55:00.000Z');
    expect(await balanceOf(ledger, s.naqd)).toBe(125_000_050);
    expect((await db.first<{ n: number }>('SELECT count(*) AS n FROM transactions'))!.n).toBe(6);
  });

  it('an operation made on this device and echoed back by the server is not counted twice', async () => {
    const { db, ledger } = await cloud();
    const w = await ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS', initialMinor: 100_000_00 });
    const cat = await ledger.createCategory(PROFILE, { name: 'Kafe' });
    const e = await ledger.expense(PROFILE, { walletId: w.id, amountMinor: 40_000_00, categoryId: cat });
    const opening = (await db.first<{ id: string }>('SELECT id FROM transactions WHERE type = ?', TxKind.Opening))!.id;

    const t = new ScriptedTransport();
    t.page = {
      ...emptyPull(),
      wallets: [wallet(w.id, 60_000)],
      categories: [{ id: cat, name: 'Kafe', icon: 'tag', color: '#EF4444', isArchived: false, sortOrder: 0 }],
      transactions: [tx({ id: opening, type: TxKind.Opening, amount: 100_000, currency: 'UZS', walletId: w.id }),
        tx({ id: e.tx.id, type: TxKind.Expense, amount: 40_000, currency: 'UZS', walletId: w.id, categoryId: cat })],
      lines: {
        [opening]: [{ kind: AccountKind.Wallet, refId: w.id, currency: 'UZS', amount: 100_000 }, { kind: AccountKind.Equity, refId: NO_REF, currency: 'UZS', amount: -100_000 }],
        [e.tx.id]: [{ kind: AccountKind.Wallet, refId: w.id, currency: 'UZS', amount: -40_000 }, { kind: AccountKind.ExpenseCategory, refId: cat, currency: 'UZS', amount: 40_000 }],
      },
    };
    const r = await new SyncEngine(db, t).run(PROFILE);
    expect(r).toMatchObject({ pushed: 3, pulled: 0, drift: [], waiting: 0 });
    expect(await balanceOf(ledger, w.id)).toBe(60_000_00);
    expect((await ledgerCheck(db, PROFILE)).ok).toBe(true);
  });

  it('a refused operation shows up as drift until the user discards it; discarding restores the server balance locally', async () => {
    const { db, ledger } = await cloud();
    const w = await ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS', initialMinor: 50_000_00 });
    const cat = await ledger.createCategory(PROFILE, { name: 'Kafe' });
    const e = await ledger.expense(PROFILE, { walletId: w.id, amountMinor: 20_000_00, categoryId: cat });

    const t = new ScriptedTransport();
    t.answer = (o) => (o.kind === 'expense' ? ['rejected', 'wallet.insufficient_funds'] : 'applied');
    t.page = { ...emptyPull(), wallets: [wallet(w.id, 50_000)] };
    const r = await new SyncEngine(db, t).run(PROFILE);
    expect(r.rejected).toBe(1);
    expect(r.drift).toEqual([{ walletId: w.id, local: 30_000_00, server: 50_000_00 }]);

    const before = (await outbox(db)).length;
    await ledger.discardRejected(PROFILE, e.tx.idempotency_key);
    expect(await balanceOf(ledger, w.id)).toBe(50_000_00);
    expect((await outbox(db)).length).toBe(before); // the undo is local only, nothing new is sent
    expect((await outbox(db)).find((o) => o.op_id === e.tx.idempotency_key)).toMatchObject({ status: 'done', last_error: expect.stringMatching(/^discarded/) });
    await expect(ledger.discardRejected(PROFILE, e.tx.idempotency_key)).rejects.toThrow(LedgerError);

    const r2 = await new SyncEngine(db, t).run(PROFILE);
    expect(r2.drift).toEqual([]);
    expect((await ledgerCheck(db, PROFILE)).ok).toBe(true);
  });

  it('a local wallet edit still waiting to be sent is not overwritten by older server data', async () => {
    const { db, ledger } = await cloud();
    const w = await ledger.createWallet(PROFILE, { name: 'Naqd', currency: 'UZS' });
    const t = new ScriptedTransport();
    await new SyncEngine(db, t).run(PROFILE); // wallet.create sent
    await ledger.updateWallet(PROFILE, w.id, 1, { name: 'Yangi nom' });

    await applyPull(db, PROFILE, { ...emptyPull(), wallets: [{ ...wallet(w.id, 0), name: 'Eski nom' }] }, new Date().toISOString());
    expect((await ledger.wallet(PROFILE, w.id))!.name).toBe('Yangi nom');

    t.fail = null;
    await new SyncEngine(db, t).run(PROFILE); // the edit is sent; now the server copy is current
    await applyPull(db, PROFILE, { ...emptyPull(), wallets: [{ ...wallet(w.id, 0), name: 'Yangi nom 2' }] }, new Date().toISOString());
    expect((await ledger.wallet(PROFILE, w.id))!.name).toBe('Yangi nom 2');
  });

  it('a pulled page is all-or-nothing: a broken entry leaves the book and the checkpoint untouched', async () => {
    const { db, ledger } = await cloud();
    const s = serverPage();
    delete s.page.lines[s.rev]; // last entry without lines
    await expect(applyPull(db, PROFILE, s.page, new Date().toISOString())).rejects.toThrow(/lines_missing/);
    expect((await db.first<{ n: number }>('SELECT count(*) AS n FROM transactions'))!.n).toBe(0);
    expect(await ledger.wallets(PROFILE)).toEqual([]);
    expect(await db.first('SELECT * FROM sync_checkpoints')).toBeNull();
  });
});

describe('identity guard', () => {
  it('a device with a guest book or another user is never silently merged', async () => {
    const db = nodeDb();
    await migrate(db);
    const ledger = new LocalLedger(db);
    await ledger.ensureLocalAccount('Guest');
    await expect(ledger.adoptCloudAccount(USER, [])).rejects.toMatchObject({ code: 'identity.merge_required' });

    const { ledger: l2 } = await cloud();
    await expect(l2.adoptCloudAccount({ ...USER, id: 'other' }, [])).rejects.toMatchObject({ code: 'identity.other_user' });
    await expect(l2.adoptCloudAccount(USER, [{ id: PROFILE, name: 'Asosiy (yangi)', baseCurrency: 'UZS' }])).resolves.toBeTruthy();
  });
});
