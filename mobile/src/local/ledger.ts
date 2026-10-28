import type { LocalDb, SqlValue } from './db';
import { NO_REF, uuid } from './ids';
import { checkMinor, convert, decimalsOf, deriveRate, minorToDecimal, MoneyError, normalizeCurrency, normalizeRate } from './money';

/** Backend enums (Hamyon.Domain) — the local book uses the same numbers so rows sync without translation. */
export const AccountKind = { Wallet: 0, IncomeSource: 1, ExpenseCategory: 2, Debt: 3, Equity: 4, Adjustment: 5, FxClearing: 6 } as const;
export const TxKind = {
  Opening: 0, Income: 1, Expense: 2, Transfer: 3, DebtBorrow: 4, DebtLend: 5, DebtRepayment: 6, DebtCollection: 7,
  Adjustment: 8, Reversal: 9,
} as const;
export const DebtDirection = { Borrowed: 0, Lent: 1 } as const;
export const DebtStatus = { Open: 0, Settled: 1, Cancelled: 2 } as const;

export class LedgerError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export interface TxRow {
  id: string; profile_id: string; type: number; occurred_at: string; amount_minor: number; currency: string;
  wallet_id: string | null; to_wallet_id: string | null; to_amount_minor: number | null; to_currency: string | null;
  fx_rate: string | null; rate_date: string | null; rate_source: string | null; category_id: string | null;
  income_source_id: string | null; person_id: string | null; debt_id: string | null; reason: string | null; memo: string | null;
  reversal_of_id: string | null; reversed_by_id: string | null; idempotency_key: string; created_at: string;
  project_id: string | null;
}

/** Details the device stores and forwards as they are (the server checks ownership of person and project). */
export interface Extra { personId?: string | null; reason?: string | null; projectId?: string | null }

export interface WalletRow {
  id: string; profile_id: string; name: string; type: number; currency: string; icon: string; color: string;
  allow_overdraft: number; is_archived: number; sort_order: number; ledger_account_id: string; revision: number;
  balance_minor: number;
}

export interface OpResult { tx: TxRow; replayed: boolean }

interface Line { account: string; amount: number }

interface Posting {
  profileId: string; type: number; key: string; occurredAt: string; amount: number; currency: string; lines: Line[];
  walletId?: string | null; toWalletId?: string | null; toAmount?: number | null; toCurrency?: string | null;
  fxRate?: string | null; rateDate?: string | null; rateSource?: string | null; categoryId?: string | null;
  sourceId?: string | null; personId?: string | null; debtId?: string | null; reason?: string | null; memo?: string | null;
  reversalOf?: string | null; projectId?: string | null;
  /** what the server must receive to replay this operation (null: nothing to sync, e.g. part of a catalog create) */
  outbox: { kind: string; payload: Record<string, unknown>; targetId?: string | null } | null;
}

/** Defaults every new profile starts with — same list as the backend (UserDefaults). */
const DEFAULT_CATEGORIES: [string, string, string][] = [
  ['Oziq-ovqat', 'food', '#F97316'], ['Transport', 'transport', '#3B82F6'], ['Kommunal', 'utilities', '#14B8A6'],
  ['Uy', 'home', '#8B5CF6'], ['Oylik', 'salary', '#EAB308'], ['Xodim', 'staff', '#EC4899'], ['Uskuna', 'equipment', '#64748B'],
  ["Ta'mirlash", 'repair', '#F43F5E'], ['Telefon va internet', 'phone', '#06B6D4'], ['Loyiha xarajatlari', 'project', '#A855F7'],
  ["Ko'ngilochar", 'fun', '#F59E0B'], ['Boshqa', 'other', '#94A3B8'],
];
const DEFAULT_SOURCES: [string, string, string][] = [
  ['Ish haqi', 'salary', '#22C55E'], ['Biznes', 'business', '#16A34A'], ['Boshqa kirim', 'other', '#84CC16'],
];

/**
 * The on-device double-entry book. Every public method that moves money is ONE SQLite transaction: journal row, balanced
 * entries, conditional balance updates (no overdraft unless allowed) and the sync-outbox row commit together or not at
 * all. Nothing here needs the network; the outbox is drained by the sync engine later.
 */
export class LocalLedger {
  constructor(private db: LocalDb, private clock: () => Date = () => new Date()) {}

  private now() {
    return this.clock().toISOString();
  }

  // ------------------------------------------------------------------ accounts & profiles

  /** First start without the server: a local account with one main profile and the default catalog. Idempotent. */
  async ensureLocalAccount(displayName = ''): Promise<{ accountId: string; profileId: string }> {
    return this.db.tx(async () => {
      const acc = await this.db.first<{ id: string }>("SELECT id FROM accounts ORDER BY created_at LIMIT 1");
      if (acc) {
        const p = await this.db.first<{ id: string }>(
          'SELECT id FROM profiles WHERE account_id = ? AND is_archived = 0 ORDER BY sort_order, created_at LIMIT 1', acc.id);
        if (p) return { accountId: acc.id, profileId: p.id };
      }
      const accountId = acc?.id ?? uuid();
      if (!acc) await this.db.run('INSERT INTO accounts (id, kind, display_name, created_at) VALUES (?, ?, ?, ?)', accountId, 'local', displayName, this.now());
      const profileId = await this.insertProfile(accountId, 'Asosiy', 'UZS', 0);
      return { accountId, profileId };
    });
  }

  /**
   * Signed-in user: the local book mirrors the server account. Profiles keep the server ids (no default catalog here:
   * it arrives with the first pull). A device that already holds a guest book or another user's book is not merged
   * silently — that is the identity step (Phase 4).
   */
  async adoptCloudAccount(user: { id: string; email?: string | null; displayName?: string | null },
    profiles: { id: string; name: string; baseCurrency: string; color?: string; icon?: string; sortOrder?: number; isArchived?: boolean }[]): Promise<string> {
    return this.db.tx(async () => {
      const acc = await this.db.first<{ id: string; kind: string; server_user_id: string | null }>('SELECT id, kind, server_user_id FROM accounts ORDER BY created_at LIMIT 1');
      if (acc && acc.kind !== 'cloud') throw new LedgerError('identity.merge_required', 'This device holds a guest book; link it first.');
      if (acc && acc.server_user_id !== user.id) throw new LedgerError('identity.other_user', "This device holds another user's book.");
      const accountId = acc?.id ?? uuid();
      const at = this.now();
      if (!acc) await this.db.run('INSERT INTO accounts (id, kind, server_user_id, email, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        accountId, 'cloud', user.id, user.email ?? null, user.displayName ?? '', at);
      for (const p of profiles)
        await this.db.run(
          `INSERT INTO profiles (id, account_id, name, color, icon, base_currency, sort_order, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, icon = excluded.icon,
             base_currency = excluded.base_currency, sort_order = excluded.sort_order, is_archived = excluded.is_archived, updated_at = excluded.updated_at`,
          p.id, accountId, p.name, p.color ?? '#4D8DFF', p.icon ?? 'person', normalizeCurrency(p.baseCurrency), p.sortOrder ?? 0,
          p.isArchived ? 1 : 0, at, at);
      return accountId;
    });
  }

  /** The device's guest book, if it holds one: its profiles and whether anything beyond the default catalog was entered. */
  async guestBook(): Promise<{ accountId: string; profiles: { id: string; name: string; baseCurrency: string; color: string; icon: string }[]; empty: boolean } | null> {
    const acc = await this.db.first<{ id: string; kind: string }>('SELECT id, kind FROM accounts ORDER BY created_at LIMIT 1');
    if (!acc || acc.kind !== 'local') return null;
    const profiles = await this.db.all<{ id: string; name: string; baseCurrency: string; color: string; icon: string }>(
      'SELECT id, name, base_currency AS baseCurrency, color, icon FROM profiles WHERE account_id = ? ORDER BY sort_order, created_at', acc.id);
    const ids = profiles.map((p) => p.id);
    let used = 0;
    for (const id of ids) {
      const r = await this.db.first<{ n: number }>(
        `SELECT (SELECT count(*) FROM wallets WHERE profile_id = ?) + (SELECT count(*) FROM transactions WHERE profile_id = ?)
              + (SELECT count(*) FROM people WHERE profile_id = ?) + (SELECT count(*) FROM sync_outbox WHERE profile_id = ? AND op_id NOT LIKE 'seed:%') AS n`,
        id, id, id, id);
      used += r?.n ?? 0;
    }
    return { accountId: acc.id, profiles, empty: used === 0 };
  }

  /**
   * Links the guest book to a server account: the same rows, now owned by that user, and their outbox (default catalog
   * included) is pushed by the next sync into the profiles the server created with these ids. Nothing is copied or dropped.
   */
  async linkGuest(user: { id: string; email?: string | null; displayName?: string | null }): Promise<void> {
    await this.db.tx(async () => {
      const acc = await this.db.first<{ id: string; kind: string; server_user_id: string | null }>('SELECT id, kind, server_user_id FROM accounts ORDER BY created_at LIMIT 1');
      if (!acc) throw new LedgerError('not_found', 'No local book.');
      if (acc.kind === 'cloud' && acc.server_user_id === user.id) return;
      if (acc.kind !== 'local') throw new LedgerError('identity.other_user', "This device holds another user's book.");
      await this.db.run("UPDATE accounts SET kind = 'cloud', server_user_id = ?, email = ?, display_name = ? WHERE id = ?",
        user.id, user.email ?? null, user.displayName ?? '', acc.id);
    });
  }

  /** A guest book with nothing entered (default catalog only) is removed instead of uploaded as an empty extra profile. */
  async dropEmptyGuest(): Promise<boolean> {
    return this.db.tx(async () => {
      const g = await this.guestBook();
      if (!g || !g.empty) return false;
      for (const p of g.profiles) {
        for (const table of ['sync_outbox', 'sync_checkpoints', 'categories', 'income_sources', 'ledger_accounts'])
          await this.db.run(`DELETE FROM ${table} WHERE profile_id = ?`, p.id);
        await this.db.run('DELETE FROM profiles WHERE id = ?', p.id);
      }
      await this.db.run('DELETE FROM accounts WHERE id = ?', g.accountId);
      return true;
    });
  }

  async createProfile(accountId: string, name: string, baseCurrency = 'UZS'): Promise<string> {
    const n = name.trim();
    if (!n || n.length > 60) throw new LedgerError('profile.name', 'Profile name must be 1-60 characters.');
    decimalsOf(baseCurrency);
    return this.db.tx(async () => {
      const count = await this.db.first<{ n: number }>('SELECT count(*) AS n FROM profiles WHERE account_id = ?', accountId);
      return this.insertProfile(accountId, n, normalizeCurrency(baseCurrency), count?.n ?? 0);
    });
  }

  private async insertProfile(accountId: string, name: string, currency: string, order: number): Promise<string> {
    const id = uuid();
    const at = this.now();
    await this.db.run(
      'INSERT INTO profiles (id, account_id, name, base_currency, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, accountId, name, currency, order, at, at);
    // the default catalog travels like anything the user creates, so a linked guest book uploads it with the same ids
    for (const [i, [n, icon, color]] of DEFAULT_CATEGORIES.entries()) {
      const c = uuid();
      await this.db.run('INSERT INTO categories (id, profile_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        c, id, n, icon, color, i, at, at);
      await this.outbox(id, `seed:category:${c}`, 'category.create', { id: c, name: n, parentId: null, icon, color });
    }
    for (const [i, [n, icon, color]] of DEFAULT_SOURCES.entries()) {
      const c = uuid();
      await this.db.run('INSERT INTO income_sources (id, profile_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        c, id, n, icon, color, i, at, at);
      await this.outbox(id, `seed:source:${c}`, 'source.create', { id: c, name: n, icon, color });
    }
    return id;
  }

  // ------------------------------------------------------------------ catalogs

  async createWallet(profileId: string, w: {
    name: string; currency: string; initialMinor?: number; type?: number; icon?: string; color?: string; allowOverdraft?: boolean;
    id?: string;
  }): Promise<WalletRow> {
    const name = w.name.trim();
    if (!name || name.length > 80) throw new LedgerError('wallet.name_required', 'Wallet name is required.');
    const currency = normalizeCurrency(w.currency);
    decimalsOf(currency);
    const initial = w.initialMinor ?? 0;
    if (initial < 0 && !w.allowOverdraft) throw new LedgerError('wallet.negative_opening', 'Negative opening balance requires overdraft.');
    if (initial !== 0) checkMinor(Math.abs(initial), currency);
    const id = w.id ?? uuid();
    await this.db.tx(async () => {
      await this.profile(profileId);
      const at = this.now();
      const acc = uuid();
      await this.db.run(
        'INSERT INTO ledger_accounts (id, profile_id, kind, ref_id, currency, name, allow_negative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        acc, profileId, AccountKind.Wallet, id, currency, name, w.allowOverdraft ? 1 : 0, at);
      const order = await this.db.first<{ n: number }>('SELECT count(*) AS n FROM wallets WHERE profile_id = ?', profileId);
      await this.db.run(
        `INSERT INTO wallets (id, profile_id, name, type, currency, icon, color, allow_overdraft, sort_order, ledger_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, profileId, name, w.type ?? 0, currency, w.icon ?? 'wallet', w.color ?? '#3B82F6', w.allowOverdraft ? 1 : 0, order?.n ?? 0, acc, at, at);
      let openingId: string | null = null;
      if (initial !== 0) {
        const equity = await this.counter(profileId, AccountKind.Equity, NO_REF, currency);
        openingId = (await this.post({
          profileId, type: TxKind.Opening, key: `open:${id}`, occurredAt: at, amount: Math.abs(initial), currency, walletId: id,
          memo: 'Opening balance', lines: [{ account: acc, amount: initial }, { account: equity, amount: -initial }],
          outbox: null, // the opening balance travels with wallet.create (same entry id on the server)
        })).id;
      }
      await this.outbox(profileId, `wallet:${id}`, 'wallet.create', {
        id, openingId, openedAt: at, name, type: w.type ?? 0, currency, initialBalance: Number(minorToDecimal(initial, currency)), icon: w.icon ?? 'wallet',
        color: w.color ?? '#3B82F6', allowOverdraft: !!w.allowOverdraft,
      });
    });
    return (await this.wallet(profileId, id))!;
  }

  async createCategory(profileId: string, c: { name: string; parentId?: string | null; icon?: string; color?: string }): Promise<string> {
    const name = c.name.trim();
    if (!name || name.length > 80) throw new LedgerError('category.name_required', 'Category name is required.');
    const id = uuid();
    await this.db.tx(async () => {
      await this.profile(profileId);
      if (c.parentId) await this.owned('categories', profileId, c.parentId, 'Category');
      const at = this.now();
      await this.db.run('INSERT INTO categories (id, profile_id, parent_id, name, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, profileId, c.parentId ?? null, name, c.icon ?? 'tag', c.color ?? '#EF4444', at, at);
      await this.outbox(profileId, `category:${id}`, 'category.create', { id, name, parentId: c.parentId ?? null, icon: c.icon ?? 'tag', color: c.color ?? '#EF4444' });
    });
    return id;
  }

  async createSource(profileId: string, s: { name: string; icon?: string; color?: string }): Promise<string> {
    const name = s.name.trim();
    if (!name || name.length > 80) throw new LedgerError('source.name_required', 'Income source name is required.');
    const id = uuid();
    await this.db.tx(async () => {
      await this.profile(profileId);
      const at = this.now();
      await this.db.run('INSERT INTO income_sources (id, profile_id, name, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, profileId, name, s.icon ?? 'briefcase', s.color ?? '#22C55E', at, at);
      await this.outbox(profileId, `source:${id}`, 'source.create', { id, name, icon: s.icon ?? 'briefcase', color: s.color ?? '#22C55E' });
    });
    return id;
  }

  /** Rename / recolour / archive. `revision` must match: a concurrent edit is reported, never overwritten. */
  async updateWallet(profileId: string, id: string, revision: number, patch: { name?: string; icon?: string; color?: string; isArchived?: boolean }) {
    return this.db.tx(async () => {
      const w = await this.wallet(profileId, id);
      if (!w) throw new LedgerError('not_found', 'Wallet not found.');
      if (patch.isArchived && w.balance_minor !== 0) throw new LedgerError('wallet.archive_nonzero', 'Only an empty wallet can be archived.');
      const r = await this.db.run(
        `UPDATE wallets SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color),
           is_archived = COALESCE(?, is_archived), revision = revision + 1, updated_at = ?
         WHERE id = ? AND profile_id = ? AND revision = ?`,
        patch.name?.trim() || null, patch.icon ?? null, patch.color ?? null,
        patch.isArchived === undefined ? null : patch.isArchived ? 1 : 0, this.now(), id, profileId, revision);
      if (r.changes === 0) throw new LedgerError('conflict.stale', 'Wallet was changed elsewhere; reload and retry.');
      await this.outbox(profileId, `wallet:${id}:r${revision + 1}`, 'wallet.update', { revision, ...patch }, id);
    });
  }

  // ------------------------------------------------------------------ money operations

  async income(profileId: string, r: { walletId: string; amountMinor: number; sourceId?: string | null; occurredAt?: string; memo?: string | null; opId?: string } & Extra): Promise<OpResult> {
    return this.op(r.opId, async (key) => {
      const w = await this.walletOrThrow(profileId, r.walletId);
      checkMinor(r.amountMinor, w.currency);
      if (r.sourceId) await this.owned('income_sources', profileId, r.sourceId, 'Income source');
      const src = await this.counter(profileId, AccountKind.IncomeSource, r.sourceId ?? NO_REF, w.currency);
      return this.post({
        profileId, type: TxKind.Income, key, occurredAt: r.occurredAt ?? this.now(), amount: r.amountMinor, currency: w.currency,
        walletId: w.id, sourceId: r.sourceId ?? null, memo: r.memo ?? null, ...extra(r),
        lines: [{ account: w.ledger_account_id, amount: r.amountMinor }, { account: src, amount: -r.amountMinor }],
        outbox: { kind: 'income', payload: {
          walletId: w.id, amount: dec(r.amountMinor, w.currency), incomeSourceId: r.sourceId ?? null, occurredAt: r.occurredAt ?? null, memo: r.memo ?? null,
          ...extra(r),
        } },
      });
    });
  }

  /** Expense; in another currency (e.g. 12 USD from a dollar wallet -> 144 000 UZS) give `toCurrency` + rate or amount. */
  async expense(profileId: string, r: {
    walletId: string; amountMinor: number; categoryId: string; occurredAt?: string; memo?: string | null; opId?: string;
    toCurrency?: string | null; toAmountMinor?: number | null; rate?: string | null; rateDate?: string | null; rateSource?: string | null;
  } & Extra): Promise<OpResult> {
    return this.op(r.opId, async (key) => {
      const w = await this.walletOrThrow(profileId, r.walletId);
      checkMinor(r.amountMinor, w.currency);
      await this.owned('categories', profileId, r.categoryId, 'Category');
      const occurredAt = r.occurredAt ?? this.now();
      const target = r.toCurrency ? normalizeCurrency(r.toCurrency) : w.currency;
      const base = { walletId: w.id, amount: dec(r.amountMinor, w.currency), categoryId: r.categoryId, occurredAt: r.occurredAt ?? null, memo: r.memo ?? null, ...extra(r) };
      if (target === w.currency) {
        if ((r.toAmountMinor != null && r.toAmountMinor !== r.amountMinor) || r.rate != null)
          throw new LedgerError('expense.fx_same_currency', 'Same-currency expense cannot carry a conversion.');
        const cat = await this.counter(profileId, AccountKind.ExpenseCategory, r.categoryId, w.currency);
        return this.post({
          profileId, type: TxKind.Expense, key, occurredAt, amount: r.amountMinor, currency: w.currency, walletId: w.id,
          categoryId: r.categoryId, memo: r.memo ?? null, ...extra(r),
          lines: [{ account: w.ledger_account_id, amount: -r.amountMinor }, { account: cat, amount: r.amountMinor }],
          outbox: { kind: 'expense', payload: base },
        });
      }
      const fx = fxLeg(r.amountMinor, w.currency, target, r.toAmountMinor, r.rate);
      const source = (r.rateSource ?? '').trim() || 'manual';
      const rateDate = r.rateDate ?? occurredAt.slice(0, 10);
      const cat = await this.counter(profileId, AccountKind.ExpenseCategory, r.categoryId, target);
      const clearFrom = await this.counter(profileId, AccountKind.FxClearing, NO_REF, w.currency);
      const clearTo = await this.counter(profileId, AccountKind.FxClearing, NO_REF, target);
      return this.post({
        profileId, type: TxKind.Expense, key, occurredAt, amount: r.amountMinor, currency: w.currency, walletId: w.id,
        toAmount: fx.toMinor, toCurrency: target, fxRate: fx.rate, rateDate, rateSource: source, categoryId: r.categoryId, memo: r.memo ?? null, ...extra(r),
        lines: [
          { account: w.ledger_account_id, amount: -r.amountMinor }, { account: clearFrom, amount: r.amountMinor },
          { account: clearTo, amount: -fx.toMinor }, { account: cat, amount: fx.toMinor },
        ],
        outbox: { kind: 'expense', payload: { ...base, toCurrency: target, toAmount: dec(fx.toMinor, target), rateDate, rateSource: source } },
      });
    });
  }

  async transfer(profileId: string, r: {
    fromWalletId: string; toWalletId: string; amountMinor: number; toAmountMinor?: number | null; rate?: string | null;
    occurredAt?: string; memo?: string | null; opId?: string; projectId?: string | null;
  }): Promise<OpResult> {
    return this.op(r.opId, async (key) => {
      if (r.fromWalletId === r.toWalletId) throw new LedgerError('transfer.same_wallet', 'Cannot transfer to the same wallet.');
      const from = await this.walletOrThrow(profileId, r.fromWalletId);
      const to = await this.walletOrThrow(profileId, r.toWalletId);
      checkMinor(r.amountMinor, from.currency);
      const occurredAt = r.occurredAt ?? this.now();
      const payload: Record<string, unknown> = {
        fromWalletId: from.id, toWalletId: to.id, amount: dec(r.amountMinor, from.currency), occurredAt: r.occurredAt ?? null, memo: r.memo ?? null,
        projectId: r.projectId ?? null,
      };
      if (from.currency === to.currency) {
        if (r.toAmountMinor != null && r.toAmountMinor !== r.amountMinor)
          throw new LedgerError('transfer.amount_mismatch', 'Same-currency transfer cannot change the amount.');
        return this.post({
          profileId, type: TxKind.Transfer, key, occurredAt, amount: r.amountMinor, currency: from.currency, walletId: from.id,
          toWalletId: to.id, toAmount: r.amountMinor, toCurrency: to.currency, memo: r.memo ?? null, projectId: r.projectId ?? null,
          lines: [{ account: from.ledger_account_id, amount: -r.amountMinor }, { account: to.ledger_account_id, amount: r.amountMinor }],
          outbox: { kind: 'transfer', payload },
        });
      }
      const fx = fxLeg(r.amountMinor, from.currency, to.currency, r.toAmountMinor, r.rate);
      const clearFrom = await this.counter(profileId, AccountKind.FxClearing, NO_REF, from.currency);
      const clearTo = await this.counter(profileId, AccountKind.FxClearing, NO_REF, to.currency);
      return this.post({
        profileId, type: TxKind.Transfer, key, occurredAt, amount: r.amountMinor, currency: from.currency, walletId: from.id,
        toWalletId: to.id, toAmount: fx.toMinor, toCurrency: to.currency, fxRate: fx.rate, memo: r.memo ?? null, projectId: r.projectId ?? null,
        lines: [
          { account: from.ledger_account_id, amount: -r.amountMinor }, { account: clearFrom, amount: r.amountMinor },
          { account: clearTo, amount: -fx.toMinor }, { account: to.ledger_account_id, amount: fx.toMinor },
        ],
        outbox: { kind: 'transfer', payload: { ...payload, toAmount: dec(fx.toMinor, to.currency) } },
      });
    });
  }

  /** Borrow (wallet up, NOT income) or lend (wallet down, NOT expense). Creates the debt and its own ledger account. */
  async debt(profileId: string, r: {
    direction: number; walletId: string; amountMinor: number; personId?: string | null; personName?: string | null;
    dueDate?: string | null; reason?: string | null; occurredAt?: string; memo?: string | null; opId?: string; projectId?: string | null;
  }): Promise<OpResult & { debtId: string }> {
    let debtId = '';
    const res = await this.op(r.opId, async (key) => {
      const w = await this.walletOrThrow(profileId, r.walletId);
      checkMinor(r.amountMinor, w.currency);
      let personId = r.personId ?? null;
      let newPerson: string | null = null;
      const at = this.now();
      if (personId) await this.owned('people', profileId, personId, 'Person');
      else if (r.personName?.trim()) {
        personId = uuid();
        newPerson = r.personName.trim();
        await this.db.run('INSERT INTO people (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)', personId, profileId, r.personName.trim(), at);
      } else throw new LedgerError('debt.person_required', 'Person is required.');
      debtId = uuid();
      const acc = uuid();
      await this.db.run(
        'INSERT INTO ledger_accounts (id, profile_id, kind, ref_id, currency, name, allow_negative, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        acc, profileId, AccountKind.Debt, debtId, w.currency, 'Debt', at);
      await this.db.run(
        `INSERT INTO debts (id, profile_id, person_id, direction, currency, principal_minor, outstanding_minor, due_date, status, reason, note, ledger_account_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        debtId, profileId, personId, r.direction, w.currency, r.amountMinor, r.amountMinor, r.dueDate ?? null, DebtStatus.Open,
        r.reason ?? null, r.memo ?? null, acc, at);
      const borrow = r.direction === DebtDirection.Borrowed;
      return this.post({
        profileId, type: borrow ? TxKind.DebtBorrow : TxKind.DebtLend, key, occurredAt: r.occurredAt ?? at, amount: r.amountMinor,
        currency: w.currency, walletId: w.id, personId, debtId, reason: r.reason ?? null, memo: r.memo ?? null, projectId: r.projectId ?? null,
        lines: [{ account: w.ledger_account_id, amount: borrow ? r.amountMinor : -r.amountMinor }, { account: acc, amount: borrow ? -r.amountMinor : r.amountMinor }],
        outbox: { kind: 'debt', payload: {
          debtId, direction: r.direction, personId, personName: newPerson, walletId: w.id, amount: dec(r.amountMinor, w.currency),
          dueDate: r.dueDate ?? null, reason: r.reason ?? null, occurredAt: r.occurredAt ?? null, memo: r.memo ?? null, projectId: r.projectId ?? null,
        } },
      });
    });
    if (res.replayed) debtId = res.tx.debt_id ?? '';
    return { ...res, debtId };
  }

  /** Repays a borrowed debt / collects a lent one; never more than what is outstanding. */
  async repay(profileId: string, debtId: string, r: { walletId: string; amountMinor: number; occurredAt?: string; memo?: string | null; opId?: string }): Promise<OpResult> {
    return this.op(r.opId, async (key) => {
      const d = await this.db.first<{ id: string; direction: number; currency: string; outstanding_minor: number; status: number; ledger_account_id: string; person_id: string }>(
        'SELECT * FROM debts WHERE id = ? AND profile_id = ?', debtId, profileId);
      if (!d) throw new LedgerError('not_found', 'Debt not found.');
      if (d.status !== DebtStatus.Open) throw new LedgerError('debt.not_open', 'Debt is not open.');
      const w = await this.walletOrThrow(profileId, r.walletId);
      if (w.currency !== d.currency) throw new LedgerError('debt.currency_mismatch', 'Repayment wallet must use the debt currency.');
      checkMinor(r.amountMinor, d.currency);
      const upd = await this.db.run(
        `UPDATE debts SET outstanding_minor = outstanding_minor - ?, status = CASE WHEN outstanding_minor - ? = 0 THEN ? ELSE status END
         WHERE id = ? AND status = ? AND outstanding_minor >= ?`,
        r.amountMinor, r.amountMinor, DebtStatus.Settled, debtId, DebtStatus.Open, r.amountMinor);
      if (upd.changes === 0) throw new LedgerError('debt.overpayment', 'Amount exceeds the outstanding debt.');
      const borrowed = d.direction === DebtDirection.Borrowed;
      return this.post({
        profileId, type: borrowed ? TxKind.DebtRepayment : TxKind.DebtCollection, key, occurredAt: r.occurredAt ?? this.now(),
        amount: r.amountMinor, currency: d.currency, walletId: w.id, personId: d.person_id, debtId, memo: r.memo ?? null,
        lines: [{ account: w.ledger_account_id, amount: borrowed ? -r.amountMinor : r.amountMinor }, { account: d.ledger_account_id, amount: borrowed ? r.amountMinor : -r.amountMinor }],
        outbox: { kind: 'repay', targetId: debtId, payload: { walletId: w.id, amount: dec(r.amountMinor, d.currency), occurredAt: r.occurredAt ?? null, memo: r.memo ?? null } },
      });
    });
  }

  /** Append-only correction: a mirror entry; the original is only linked, never edited or deleted. */
  async reverse(profileId: string, txId: string, memo?: string, localOnly = false): Promise<OpResult> {
    return this.op(`rev:${txId}`, async (key) => {
      const t = await this.db.first<TxRow>('SELECT * FROM transactions WHERE id = ? AND profile_id = ?', txId, profileId);
      if (!t) throw new LedgerError('not_found', 'Transaction not found.');
      if (t.type === TxKind.Reversal || t.type === TxKind.Opening) throw new LedgerError('reverse.not_allowed', 'This entry cannot be reversed.');
      if (t.reversed_by_id) throw new LedgerError('reverse.already', 'Transaction was already reversed.');
      if (t.debt_id) await this.undoDebt(t);
      const lines = await this.db.all<{ ledger_account_id: string; amount_minor: number }>(
        'SELECT ledger_account_id, amount_minor FROM transaction_entries WHERE transaction_id = ?', t.id);
      const res = await this.post({
        profileId, type: TxKind.Reversal, key, occurredAt: this.now(), amount: t.amount_minor, currency: t.currency, walletId: t.wallet_id,
        toWalletId: t.to_wallet_id, toAmount: t.to_amount_minor, toCurrency: t.to_currency, fxRate: t.fx_rate, rateDate: t.rate_date,
        rateSource: t.rate_source, categoryId: t.category_id, sourceId: t.income_source_id, personId: t.person_id, debtId: t.debt_id,
        reason: t.reason, memo: memo ?? `Reversal of ${t.id}`, reversalOf: t.id, projectId: t.project_id,
        lines: lines.map((l) => ({ account: l.ledger_account_id, amount: -l.amount_minor })),
        outbox: localOnly ? null : { kind: 'reverse', targetId: t.id, payload: { memo: memo ?? null } },
      });
      const linked = await this.db.run('UPDATE transactions SET reversed_by_id = ?, updated_at = ? WHERE id = ? AND reversed_by_id IS NULL', res.id, this.now(), t.id);
      if (linked.changes === 0) throw new LedgerError('reverse.already', 'Transaction was already reversed.');
      return res;
    });
  }

  /**
   * The server refused an operation (e.g. the money was already spent on another device): the device undoes it with a
   * local reversal so its balances match the server again. The refused outbox row is kept (status done, reason kept).
   */
  async discardRejected(profileId: string, opId: string): Promise<OpResult | null> {
    const op = await this.db.first<{ status: string; last_error: string | null }>(
      'SELECT status, last_error FROM sync_outbox WHERE op_id = ? AND profile_id = ?', opId, profileId);
    if (!op || op.status !== 'rejected') throw new LedgerError('sync.not_rejected', 'Only a refused operation can be discarded.');
    const tx = await this.db.first<TxRow>('SELECT * FROM transactions WHERE idempotency_key = ? AND profile_id = ?', opId, profileId);
    const res = tx && !tx.reversed_by_id ? await this.reverse(profileId, tx.id, 'Rejected by server', true) : null;
    await this.db.run("UPDATE sync_outbox SET status = 'done', last_error = ? WHERE op_id = ?", `discarded: ${op.last_error ?? ''}`, opId);
    return res;
  }

  private async undoDebt(t: TxRow) {
    if (t.type === TxKind.DebtBorrow || t.type === TxKind.DebtLend) {
      const r = await this.db.run(
        'UPDATE debts SET status = ?, outstanding_minor = 0 WHERE id = ? AND outstanding_minor = principal_minor AND status = ?',
        DebtStatus.Cancelled, t.debt_id, DebtStatus.Open);
      if (r.changes === 0) throw new LedgerError('debt.has_repayments', 'Debt already has repayments; reverse them first.');
    } else if (t.type === TxKind.DebtRepayment || t.type === TxKind.DebtCollection) {
      const r = await this.db.run(
        'UPDATE debts SET outstanding_minor = outstanding_minor + ?, status = ? WHERE id = ? AND status <> ? AND outstanding_minor + ? <= principal_minor',
        t.amount_minor, DebtStatus.Open, t.debt_id, DebtStatus.Cancelled, t.amount_minor);
      if (r.changes === 0) throw new LedgerError('debt.reverse_failed', 'Cannot restore this debt.');
    }
  }

  // ------------------------------------------------------------------ reads

  async wallet(profileId: string, id: string): Promise<WalletRow | null> {
    return this.db.first<WalletRow>(
      `SELECT w.*, a.balance_minor FROM wallets w JOIN ledger_accounts a ON a.id = w.ledger_account_id WHERE w.id = ? AND w.profile_id = ?`,
      id, profileId);
  }

  async wallets(profileId: string): Promise<WalletRow[]> {
    return this.db.all<WalletRow>(
      `SELECT w.*, a.balance_minor FROM wallets w JOIN ledger_accounts a ON a.id = w.ledger_account_id
       WHERE w.profile_id = ? ORDER BY w.sort_order, w.created_at`, profileId);
  }

  async transaction(profileId: string, id: string) {
    return this.db.first<TxRow>('SELECT * FROM transactions WHERE id = ? AND profile_id = ?', id, profileId);
  }

  // ------------------------------------------------------------------ internals

  /** Runs one operation in one transaction; a repeated operation id returns the stored result instead of a second write. */
  private async op(opId: string | undefined, work: (key: string) => Promise<TxRow>): Promise<OpResult> {
    const key = opId ?? uuid();
    return this.db.tx(async () => {
      const prior = await this.db.first<TxRow>('SELECT * FROM transactions WHERE idempotency_key = ?', key);
      if (prior) return { tx: prior, replayed: true };
      return { tx: await work(key), replayed: false };
    });
  }

  private async post(p: Posting): Promise<TxRow> {
    if (p.lines.length < 2) throw new LedgerError('ledger.too_few_lines', 'A journal entry needs at least two lines.');
    const accounts = new Map<string, { currency: string; allow_negative: number; name: string }>();
    for (const l of p.lines) {
      if (l.amount === 0 || !Number.isSafeInteger(l.amount)) throw new LedgerError('ledger.zero_line', 'Invalid line amount.');
      if (accounts.has(l.account)) continue;
      const a = await this.db.first<{ currency: string; allow_negative: number; name: string }>(
        'SELECT currency, allow_negative, name FROM ledger_accounts WHERE id = ? AND profile_id = ?', l.account, p.profileId);
      if (!a) throw new LedgerError('not_found', 'Account not found.');
      accounts.set(l.account, a);
    }
    const sums = new Map<string, number>();
    for (const l of p.lines) {
      const c = accounts.get(l.account)!.currency;
      sums.set(c, (sums.get(c) ?? 0) + l.amount);
    }
    for (const [c, s] of sums) if (s !== 0) throw new LedgerError('ledger.unbalanced', `Entry does not balance in ${c}.`);

    if (p.type !== TxKind.Reversal) {
      const archived = await this.db.first<{ name: string }>(
        `SELECT name FROM wallets WHERE profile_id = ? AND is_archived = 1 AND ledger_account_id IN (${p.lines.map(() => '?').join(',')})`,
        p.profileId, ...p.lines.map((l) => l.account));
      if (archived) throw new LedgerError('wallet.archived', `Wallet '${archived.name}' is archived.`);
    }

    const id = uuid();
    const at = this.now();
    const cols: [string, SqlValue][] = [
      ['id', id], ['profile_id', p.profileId], ['type', p.type], ['occurred_at', new Date(p.occurredAt).toISOString()],
      ['amount_minor', p.amount], ['currency', p.currency], ['wallet_id', p.walletId ?? null], ['to_wallet_id', p.toWalletId ?? null],
      ['to_amount_minor', p.toAmount ?? null], ['to_currency', p.toCurrency ?? null], ['fx_rate', p.fxRate ?? null],
      ['rate_date', p.rateDate ?? null], ['rate_source', p.rateSource ?? null], ['category_id', p.categoryId ?? null],
      ['income_source_id', p.sourceId ?? null], ['person_id', p.personId ?? null], ['debt_id', p.debtId ?? null],
      ['reason', p.reason ?? null], ['memo', p.memo ?? null], ['reversal_of_id', p.reversalOf ?? null], ['project_id', p.projectId ?? null],
      ['idempotency_key', p.key], ['created_at', at], ['updated_at', at],
    ];
    await this.db.run(`INSERT INTO transactions (${cols.map((c) => c[0]).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => c[1]));
    for (const l of p.lines)
      await this.db.run('INSERT INTO transaction_entries (id, transaction_id, profile_id, ledger_account_id, amount_minor, currency) VALUES (?, ?, ?, ?, ?, ?)',
        uuid(), id, p.profileId, l.account, l.amount, accounts.get(l.account)!.currency);

    // net delta per account; a decrease may not take a non-negative account below zero
    const deltas = new Map<string, number>();
    for (const l of p.lines) deltas.set(l.account, (deltas.get(l.account) ?? 0) + l.amount);
    for (const [acc, delta] of [...deltas].sort((a, b) => a[0].localeCompare(b[0]))) {
      const r = await this.db.run(
        'UPDATE ledger_accounts SET balance_minor = balance_minor + ? WHERE id = ? AND (allow_negative = 1 OR ? >= 0 OR balance_minor + ? >= 0)',
        delta, acc, delta, delta);
      if (r.changes === 0) throw new LedgerError('wallet.insufficient_funds', `Insufficient funds in '${accounts.get(acc)!.name}'.`);
    }
    if (p.outbox) await this.outbox(p.profileId, p.key, p.outbox.kind, { ...p.outbox.payload, id }, p.outbox.targetId ?? null);
    return (await this.db.first<TxRow>('SELECT * FROM transactions WHERE id = ?', id))!;
  }

  private async outbox(profileId: string, opId: string, kind: string, payload: Record<string, unknown>, targetId: string | null = null) {
    await this.db.run('INSERT INTO sync_outbox (op_id, profile_id, kind, payload, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      opId, profileId, kind, JSON.stringify(payload), targetId, this.now());
  }

  /** Counter-accounts (income, expense, equity, FX clearing) are created lazily, one per (profile, kind, ref, currency). */
  private async counter(profileId: string, kind: number, ref: string, currency: string): Promise<string> {
    const found = await this.db.first<{ id: string }>(
      'SELECT id FROM ledger_accounts WHERE profile_id = ? AND kind = ? AND ref_id = ? AND currency = ?', profileId, kind, ref, currency);
    if (found) return found.id;
    const id = uuid();
    await this.db.run(
      'INSERT INTO ledger_accounts (id, profile_id, kind, ref_id, currency, name, allow_negative, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      id, profileId, kind, ref, currency, '', this.now());
    return id;
  }

  private async walletOrThrow(profileId: string, id: string): Promise<WalletRow> {
    const w = await this.wallet(profileId, id);
    if (!w) throw new LedgerError('not_found', 'Wallet not found.');
    return w;
  }

  private async owned(table: 'categories' | 'income_sources' | 'people', profileId: string, id: string, what: string) {
    const r = await this.db.first<{ id: string }>(`SELECT id FROM ${table} WHERE id = ? AND profile_id = ?`, id, profileId);
    if (!r) throw new LedgerError('not_found', `${what} not found.`);
  }

  private async profile(profileId: string) {
    const p = await this.db.first<{ id: string }>('SELECT id FROM profiles WHERE id = ? AND is_archived = 0', profileId);
    if (!p) throw new LedgerError('profile.not_found', 'Profile not found.');
  }
}

/** Same names in the journal row (Posting) and in the server payload. */
const extra = (r: Extra) => ({ personId: r.personId ?? null, reason: r.reason ?? null, projectId: r.projectId ?? null });

/** Exact decimal for the server payload (JSON number with at most 15 significant digits: amounts < 1e13 with 2 places). */
const dec = (minor: number, currency: string) => Number(minorToDecimal(minor, currency));

function fxLeg(amountMinor: number, from: string, to: string, toAmountMinor?: number | null, rate?: string | null) {
  decimalsOf(to);
  if (toAmountMinor != null) {
    checkMinor(toAmountMinor, to);
    return { toMinor: toAmountMinor, rate: deriveRate(amountMinor, from, toAmountMinor, to) };
  }
  if (rate != null) return { toMinor: convert(amountMinor, from, rate, to), rate: normalizeRate(rate) };
  throw new MoneyError('fx.rate_required', 'Different currencies: provide the converted amount or the rate.');
}
