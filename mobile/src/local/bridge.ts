import { Platform } from 'react-native';
import { ApiError } from '@/api/client';
import type { Category, Debt, IncomeSource, PendingOp, Person, Project, Snapshot, Tx, TxTypeValue, UserProfile, Wallet } from '@/api/types';
import { openLocalDb } from '@/offline/sqlite';
import { getStorage } from '@/offline/storage';
import { api } from '@/state/runtime';
import type { LocalDb } from './db';
import { httpTransport } from './httpTransport';
import { LedgerError, LocalLedger, type OpResult } from './ledger';
import { minorToNumber, toMinor } from './money';
import { SyncEngine, type SyncTransport } from './sync';

export interface LocalBook { db: LocalDb; ledger: LocalLedger; engine: SyncEngine; profileId: string }

let current: { userId: string; book: Promise<LocalBook | null> } | null = null;

/**
 * The on-device book for the signed-in user, or null when the app should keep using the server directly: web, the
 * beta switch off, a failed local migration, or a device that holds another book (identity step not done yet).
 */
export function localBook(user: UserProfile | null, enabled: boolean): Promise<LocalBook | null> {
  if (Platform.OS === 'web' || !enabled || !user) return Promise.resolve(null);
  if (current?.userId !== user.id) {
    const book = open(user);
    current = { userId: user.id, book };
    // a failed open is retried next time (e.g. first start offline: profiles unknown yet)
    void book.then((b) => {
      if (!b && current?.book === book) current = null;
    });
  }
  return current.book;
}

async function open(user: UserProfile): Promise<LocalBook | null> {
  try {
    const db = await openLocalDb();
    const ledger = new LocalLedger(db);
    let profiles: { id: string; name: string; baseCurrency: string; color?: string; icon?: string; sortOrder?: number; isArchived?: boolean; isCurrent?: boolean }[] | null = null;
    try {
      profiles = await api.get('/api/profiles');
    } catch (e) {
      if (!(e instanceof ApiError && e.isNetwork)) throw e;
    }
    if (profiles) await ledger.adoptCloudAccount(user, profiles);
    const known = await db.all<{ id: string }>(
      `SELECT p.id FROM profiles p JOIN accounts a ON a.id = p.account_id
       WHERE a.server_user_id = ? AND p.is_archived = 0 ORDER BY p.sort_order, p.created_at`, user.id);
    const profileId = profiles?.find((p) => p.isCurrent)?.id ?? known[0]?.id;
    if (!profileId || !known.some((k) => k.id === profileId)) return null;
    return { db, ledger, profileId, engine: new SyncEngine(db, keepProjects(db, httpTransport(api))) };
  } catch (e) {
    try {
      await (await getStorage()).logUpdate('local-book-unavailable', e instanceof Error ? e.message.slice(0, 300) : String(e));
    } catch {
      /* logging is best effort */
    }
    return null;
  }
}

/** Projects are not in the local book yet: the copy from the last pull is kept for the screens. */
function keepProjects(db: LocalDb, t: SyncTransport): SyncTransport {
  return {
    push: t.push,
    async pull(profileId, since) {
      const page = await t.pull(profileId, since);
      const projects = (page as unknown as { projects?: Project[] }).projects;
      if (projects) await db.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', `local:projects:${profileId}`, JSON.stringify(projects));
      return page;
    },
  };
}

// ------------------------------------------------------------------ book -> screens (same shapes as /api/sync/pull)

export async function localSnapshot(book: LocalBook): Promise<Snapshot> {
  const { db, profileId: p } = book;
  const num = (minor: number | null, currency: string | null) => (minor == null || !currency ? null : minorToNumber(minor, currency));
  const wallets = await db.all<{ id: string; name: string; type: number; currency: string; balance_minor: number; icon: string; color: string; bank_name: string | null;
    masked_number: string | null; note: string | null; allow_overdraft: number; is_archived: number; sort_order: number }>(
    `SELECT w.*, a.balance_minor FROM wallets w JOIN ledger_accounts a ON a.id = w.ledger_account_id WHERE w.profile_id = ? ORDER BY w.sort_order, w.created_at`, p);
  const categories = await db.all<{ id: string; name: string; icon: string; color: string; parent_id: string | null; monthly_limit_minor: number | null;
    limit_currency: string | null; is_archived: number; sort_order: number }>('SELECT * FROM categories WHERE profile_id = ? ORDER BY sort_order, name', p);
  const sources = await db.all<{ id: string; name: string; icon: string; color: string; is_archived: number; sort_order: number }>(
    'SELECT * FROM income_sources WHERE profile_id = ? ORDER BY sort_order, name', p);
  const people = await db.all<{ id: string; name: string; phone: string | null; note: string | null }>('SELECT * FROM people WHERE profile_id = ? ORDER BY name', p);
  const debts = await db.all<{ id: string; person_id: string; direction: number; currency: string; principal_minor: number; outstanding_minor: number;
    due_date: string | null; status: number; reason: string | null; note: string | null; created_at: string }>('SELECT * FROM debts WHERE profile_id = ?', p);
  const txs = await db.all<{ id: string; type: number; occurred_at: string; amount_minor: number; currency: string; wallet_id: string | null; to_wallet_id: string | null;
    to_amount_minor: number | null; to_currency: string | null; fx_rate: string | null; rate_date: string | null; rate_source: string | null; category_id: string | null;
    income_source_id: string | null; person_id: string | null; project_id: string | null; debt_id: string | null; reason: string | null; memo: string | null;
    reversal_of_id: string | null; reversed_by_id: string | null; replaces_id: string | null; created_at: string }>(
    'SELECT * FROM transactions WHERE profile_id = ? ORDER BY occurred_at DESC LIMIT 1000', p);
  const projectsRaw = (await db.first<{ v: string }>('SELECT v FROM kv WHERE k = ?', `local:projects:${p}`))?.v;

  return {
    cursor: new Date().toISOString(),
    hasMore: false,
    wallets: wallets.map((w): Wallet => ({
      id: w.id, name: w.name, type: w.type, currency: w.currency, balance: minorToNumber(w.balance_minor, w.currency), icon: w.icon, color: w.color,
      bankName: w.bank_name, maskedNumber: w.masked_number, note: w.note, allowOverdraft: !!w.allow_overdraft, isArchived: !!w.is_archived, sortOrder: w.sort_order,
    })),
    categories: categories.map((c): Category => ({
      id: c.id, name: c.name, icon: c.icon, color: c.color, parentId: c.parent_id, monthlyLimit: num(c.monthly_limit_minor, c.limit_currency),
      limitCurrency: c.limit_currency, isArchived: !!c.is_archived, sortOrder: c.sort_order,
    })),
    incomeSources: sources.map((s): IncomeSource => ({ id: s.id, name: s.name, icon: s.icon, color: s.color, isArchived: !!s.is_archived, sortOrder: s.sort_order })),
    people: people.map((x): Person => ({ id: x.id, name: x.name, phone: x.phone, note: x.note })),
    projects: projectsRaw ? (JSON.parse(projectsRaw) as Project[]) : [],
    debts: debts.map((d): Debt => ({
      id: d.id, personId: d.person_id, direction: d.direction, currency: d.currency, principal: minorToNumber(d.principal_minor, d.currency),
      outstanding: minorToNumber(d.outstanding_minor, d.currency), dueDate: d.due_date, status: d.status,
      reason: d.reason, note: d.note, createdAt: d.created_at,
    })),
    transactions: txs.map((t): Tx => ({
      id: t.id, type: t.type as TxTypeValue, occurredAt: t.occurred_at, amount: minorToNumber(t.amount_minor, t.currency), currency: t.currency,
      walletId: t.wallet_id, toWalletId: t.to_wallet_id, toAmount: num(t.to_amount_minor, t.to_currency), toCurrency: t.to_currency,
      fxRate: t.fx_rate == null ? null : Number(t.fx_rate), rateDate: t.rate_date, rateSource: t.rate_source, categoryId: t.category_id,
      incomeSourceId: t.income_source_id, personId: t.person_id, projectId: t.project_id, debtId: t.debt_id, reason: t.reason, memo: t.memo,
      reversalOfId: t.reversal_of_id, reversedById: t.reversed_by_id, replacesId: t.replaces_id, createdAt: t.created_at,
    })),
  };
}

// ------------------------------------------------------------------ screens -> book (the operation sheet's payloads)

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Writes one operation from the screens into the book (one SQLite transaction, outbox included). */
export async function applyUiOp(book: LocalBook, kind: PendingOp['kind'], payload: Record<string, unknown>, targetId?: string | null): Promise<OpResult> {
  const { ledger, profileId } = book;
  const walletOf = async (id: unknown) => {
    const w = typeof id === 'string' ? await ledger.wallet(profileId, id) : null;
    if (!w) throw new LedgerError('not_found', 'Wallet not found.');
    return w;
  };
  const minor = (v: unknown, currency: string) => toMinor(String(v), currency);
  const common = {
    occurredAt: str(payload.occurredAt) ?? undefined, memo: str(payload.memo), projectId: str(payload.projectId),
  };
  switch (kind) {
    case 'income': {
      const w = await walletOf(payload.walletId);
      return ledger.income(profileId, {
        walletId: w.id, amountMinor: minor(payload.amount, w.currency), sourceId: str(payload.incomeSourceId),
        personId: str(payload.personId), reason: str(payload.reason), ...common,
      });
    }
    case 'expense': {
      const w = await walletOf(payload.walletId);
      return ledger.expense(profileId, {
        walletId: w.id, amountMinor: minor(payload.amount, w.currency), categoryId: String(payload.categoryId), personId: str(payload.personId), ...common,
      });
    }
    case 'transfer': {
      const from = await walletOf(payload.fromWalletId);
      const to = await walletOf(payload.toWalletId);
      return ledger.transfer(profileId, {
        fromWalletId: from.id, toWalletId: to.id, amountMinor: minor(payload.amount, from.currency),
        toAmountMinor: payload.toAmount == null ? null : minor(payload.toAmount, to.currency), ...common,
      });
    }
    case 'debt': {
      const w = await walletOf(payload.walletId);
      return ledger.debt(profileId, {
        direction: Number(payload.direction), walletId: w.id, amountMinor: minor(payload.amount, w.currency), personId: str(payload.personId),
        personName: str(payload.personName), dueDate: str(payload.dueDate), reason: str(payload.reason), ...common,
      });
    }
    case 'repay': {
      const w = await walletOf(payload.walletId);
      return ledger.repay(profileId, String(targetId), { walletId: w.id, amountMinor: minor(payload.amount, w.currency), ...common });
    }
    case 'reverse':
      return ledger.reverse(profileId, String(targetId), str(payload.memo) ?? undefined);
  }
}
