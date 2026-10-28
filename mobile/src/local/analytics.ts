import type {
  BalanceHistory, BreakdownRow, BudgetStatus, CurrencyTotals, DebtPosition, SeriesPoint, Summary, TopExpense, Tx, WalletPeriod,
} from '@/api/types';
import type { LocalDb } from './db';
import { DebtDirection, DebtStatus, TxKind } from './ledger';
import { minorToNumber } from './money';
import { txFromRow, type TxRecord } from './bridge';

/**
 * The analytics endpoints answered from the device's book, with the backend's rules (AnalyticsService /
 * TransactionFilter): currencies are never added together; transfers, openings and debts are not income or expense;
 * an expense paid in another currency counts in the currency it was spent in; reversed entries are left out.
 * Sums are made in minor units (integers) and turned into numbers only for the screens.
 */
export type LocalQuery = Record<string, string | number | boolean | undefined | null>;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const numOf = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const pct = (part: number, total: number, digits: number) => (total === 0 ? 0 : Math.round((part / total) * 100 * 10 ** digits) / 10 ** digits);

/** Expense in another currency: the spent side (backend ExpCur / ExpAmt). */
const expCur = (t: TxRecord) => (t.type === TxKind.Expense && t.to_currency ? t.to_currency : t.currency);
const expAmt = (t: TxRecord) => (t.type === TxKind.Expense && t.to_amount_minor != null ? t.to_amount_minor : t.amount_minor);

/** Same filter as the backend's TransactionFilter.Apply (history list, analytics and exports). */
export async function filtered(db: LocalDb, profileId: string, q: LocalQuery): Promise<TxRecord[]> {
  const rows = await db.all<TxRecord>('SELECT * FROM transactions WHERE profile_id = ?', profileId);
  const from = str(q.from) ? Date.parse(String(q.from)) : undefined;
  const to = str(q.to) ? Date.parse(String(q.to)) : undefined;
  const wallet = str(q.walletId);
  const category = str(q.categoryId);
  const children = category
    ? new Set((await db.all<{ id: string }>('SELECT id FROM categories WHERE profile_id = ? AND parent_id = ?', profileId, category)).map((c) => c.id))
    : null;
  const type = numOf(q.type);
  const currency = str(q.currency)?.toUpperCase();
  const min = numOf(q.minAmount);
  const max = numOf(q.maxAmount);
  const text = str(q.q)?.toLowerCase();
  const names = text ? await nameIndex(db, profileId) : null;
  return rows.filter((t) => {
    if (q.includeReversed !== true && q.includeReversed !== 'true' && (t.reversed_by_id || t.reversal_of_id)) return false;
    const at = Date.parse(t.occurred_at);
    if (from !== undefined && at < from) return false;
    if (to !== undefined && at > to) return false;
    if (wallet && t.wallet_id !== wallet && t.to_wallet_id !== wallet) return false;
    if (category && t.category_id !== category && !(t.category_id && children!.has(t.category_id))) return false;
    if (str(q.projectId) && t.project_id !== q.projectId) return false;
    if (str(q.sourceId) && t.income_source_id !== q.sourceId) return false;
    if (str(q.personId) && t.person_id !== q.personId) return false;
    if (type !== undefined && t.type !== type) return false;
    if (currency && t.currency !== currency && t.to_currency !== currency) return false;
    const amount = minorToNumber(t.amount_minor, t.currency);
    if (min !== undefined && amount < min) return false;
    if (max !== undefined && amount > max) return false;
    if (text) {
      const hay = [t.memo, t.reason, String(amount), names!.get(t.person_id ?? ''), names!.get(t.category_id ?? ''),
        names!.get(t.income_source_id ?? ''), names!.get(t.project_id ?? '')];
      if (!hay.some((h) => h && h.toLowerCase().includes(text))) return false;
    }
    return true;
  });
}

async function nameIndex(db: LocalDb, profileId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const table of ['categories', 'income_sources', 'people', 'wallets'])
    for (const r of await db.all<{ id: string; name: string }>(`SELECT id, name FROM ${table} WHERE profile_id = ?`, profileId)) m.set(r.id, r.name);
  // projects are not in the local book yet: the copy from the last pull
  const raw = (await db.first<{ v: string }>('SELECT v FROM kv WHERE k = ?', `local:projects:${profileId}`))?.v;
  for (const p of raw ? (JSON.parse(raw) as { id: string; name: string }[]) : []) m.set(p.id, p.name);
  return m;
}

export async function summary(db: LocalDb, profileId: string, q: LocalQuery): Promise<Summary> {
  const rows = await filtered(db, profileId, q);
  const field: Partial<Record<number, keyof CurrencyTotals>> = {
    [TxKind.Income]: 'income', [TxKind.Expense]: 'expense', [TxKind.DebtBorrow]: 'borrowed', [TxKind.DebtLend]: 'lent',
    [TxKind.DebtRepayment]: 'debtRepaid', [TxKind.DebtCollection]: 'debtCollected',
  };
  const minor = new Map<string, Record<string, number>>();
  for (const t of rows) {
    const f = field[t.type]; // openings, transfers and adjustments are not activity
    if (!f) continue;
    const c = expCur(t);
    const acc = minor.get(c) ?? {};
    acc[f] = (acc[f] ?? 0) + expAmt(t);
    minor.set(c, acc);
  }
  const totals = [...minor.keys()].sort().map((c): CurrencyTotals => {
    const m = minor.get(c)!;
    const n = (k: string) => minorToNumber(m[k] ?? 0, c);
    return {
      currency: c, income: n('income'), expense: n('expense'), netFlow: minorToNumber((m.income ?? 0) - (m.expense ?? 0), c),
      borrowed: n('borrowed'), lent: n('lent'), debtRepaid: n('debtRepaid'), debtCollected: n('debtCollected'),
    };
  });

  const open = await db.all<{ currency: string; direction: number; total: number }>(
    'SELECT currency, direction, SUM(outstanding_minor) AS total FROM debts WHERE profile_id = ? AND status = ? GROUP BY currency, direction',
    profileId, DebtStatus.Open);
  const debts = [...new Set(open.map((d) => d.currency))].sort().map((c): DebtPosition => ({
    currency: c,
    iOwe: minorToNumber(open.filter((d) => d.currency === c && d.direction === DebtDirection.Borrowed).reduce((s, d) => s + d.total, 0), c),
    owedToMe: minorToNumber(open.filter((d) => d.currency === c && d.direction === DebtDirection.Lent).reduce((s, d) => s + d.total, 0), c),
  }));

  const names = await nameIndex(db, profileId);
  const topExpenses = rows.filter((t) => t.type === TxKind.Expense)
    .map((t) => ({ t, value: minorToNumber(expAmt(t), expCur(t)) }))
    .sort((a, b) => b.value - a.value).slice(0, 5)
    .map(({ t, value }): TopExpense => ({
      id: t.id, occurredAt: t.occurred_at, amount: value, currency: expCur(t), category: t.category_id ? names.get(t.category_id) ?? null : null, memo: t.memo,
    }));
  return { totals, debts, topExpenses };
}

// ------------------------------------------------------------------ calendar buckets in the client's time zone

type Granularity = 'day' | 'week' | 'month' | 'year';
const gran = (g: unknown): Granularity => (g === 'week' || g === 'month' || g === 'year' ? g : 'day');
const MAX_BUCKETS = 400;

/** Start of the bucket holding `t` in the calendar of UTC offset `off` minutes, as a UTC epoch (backend BucketStart). */
export function bucketStart(t: number, g: Granularity, off: number): number {
  const l = new Date(t + off * 60_000);
  let y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate();
  if (g === 'year') { m = 0; d = 1; }
  else if (g === 'month') d = 1;
  else if (g === 'week') d -= (l.getUTCDay() + 6) % 7; // Monday
  return Date.UTC(y, m, d) - off * 60_000;
}

function next(start: number, g: Granularity, off: number): number {
  const l = new Date(start + off * 60_000);
  const y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate();
  const n = g === 'year' ? Date.UTC(y + 1, m, d) : g === 'month' ? Date.UTC(y, m + 1, d) : Date.UTC(y, m, d + (g === 'week' ? 7 : 1));
  return n - off * 60_000;
}

function buckets(from: number, to: number, g: Granularity, off: number): number[] {
  const out: number[] = [];
  const last = bucketStart(to, g, off);
  for (let b = bucketStart(from, g, off); b <= last && out.length <= MAX_BUCKETS + 1; b = next(b, g, off)) out.push(b);
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function label(start: number, g: Granularity, off: number): string {
  const l = new Date(start + off * 60_000);
  const y = String(l.getUTCFullYear());
  if (g === 'year') return y;
  if (g === 'month') return `${y}-${pad(l.getUTCMonth() + 1)}`;
  return `${y}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`;
}

/** ISO time in the client's offset, as the backend serializes `Start.ToOffset(off)`. */
function isoAt(start: number, off: number): string {
  const l = new Date(start + off * 60_000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}T${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}:${pad(l.getUTCSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const offsetOf = (q: LocalQuery) => Math.min(840, Math.max(-720, Number(q.tz ?? 0) || 0));

export async function timeSeries(db: LocalDb, profileId: string, q: LocalQuery, granularity: unknown): Promise<SeriesPoint[]> {
  const g = gran(granularity);
  const off = offsetOf(q);
  const rows = (await filtered(db, profileId, q)).filter((t) => t.type === TxKind.Income || t.type === TxKind.Expense);
  const grouped = new Map<string, { start: number; currency: string; income: number; expense: number }>();
  for (const t of rows) {
    const start = bucketStart(Date.parse(t.occurred_at), g, off);
    const c = expCur(t);
    const k = `${start}|${c}`;
    const v = grouped.get(k) ?? { start, currency: c, income: 0, expense: 0 };
    if (t.type === TxKind.Income) v.income += expAmt(t);
    else v.expense += expAmt(t);
    grouped.set(k, v);
  }
  let keys = [...grouped.values()].map((v) => ({ start: v.start, currency: v.currency }));
  if (str(q.from) && str(q.to) && grouped.size > 0) {
    const all = buckets(Date.parse(String(q.from)), Date.parse(String(q.to)), g, off);
    if (all.length <= MAX_BUCKETS) keys = [...new Set(keys.map((k) => k.currency))].flatMap((currency) => all.map((start) => ({ start, currency })));
  }
  return keys.sort((a, b) => a.start - b.start || a.currency.localeCompare(b.currency)).map((k) => {
    const v = grouped.get(`${k.start}|${k.currency}`);
    return {
      period: label(k.start, g, off), start: isoAt(k.start, off), currency: k.currency,
      income: minorToNumber(v?.income ?? 0, k.currency), expense: minorToNumber(v?.expense ?? 0, k.currency),
    };
  });
}

export async function breakdown(db: LocalDb, profileId: string, q: LocalQuery, by: unknown): Promise<BreakdownRow[]> {
  const type = numOf(q.type) ?? TxKind.Expense;
  const rows = await filtered(db, profileId, { ...q, type });
  const key = (t: TxRecord) => (by === 'wallet' ? t.wallet_id : by === 'project' ? t.project_id : by === 'person' ? t.person_id
    : by === 'source' ? t.income_source_id : t.category_id);
  const names = await nameIndex(db, profileId);
  const out: BreakdownRow[] = [];
  for (const c of [...new Set(rows.map(expCur))].sort()) {
    const inCur = rows.filter((t) => expCur(t) === c);
    const total = inCur.reduce((s, t) => s + expAmt(t), 0);
    const groups = new Map<string | null, { sum: number; count: number }>();
    for (const t of inCur) {
      const g = groups.get(key(t)) ?? { sum: 0, count: 0 };
      g.sum += expAmt(t);
      g.count++;
      groups.set(key(t), g);
    }
    for (const [id, g] of [...groups.entries()].sort((a, b) => b[1].sum - a[1].sum))
      out.push({ id, name: (id && names.get(id)) || '—', currency: c, total: minorToNumber(g.sum, c), percent: pct(g.sum, total, 2), count: g.count });
  }
  return out;
}

/** Wallet lines (the source of truth) with the time of their entry; filters: wallet, currency, project. */
async function walletLines(db: LocalDb, profileId: string, q: LocalQuery) {
  const wallets = (await db.all<{ id: string; name: string; currency: string; ledger_account_id: string; is_archived: number }>(
    'SELECT id, name, currency, ledger_account_id, is_archived FROM wallets WHERE profile_id = ? ORDER BY sort_order, created_at', profileId))
    .filter((w) => (!str(q.walletId) || w.id === q.walletId) && (!str(q.currency) || w.currency === String(q.currency).trim().toUpperCase()));
  const lines = await db.all<{ account: string; amount: number; currency: string; project_id: string | null; at: string }>(
    `SELECT e.ledger_account_id AS account, e.amount_minor AS amount, e.currency, t.project_id, t.occurred_at AS at
     FROM transaction_entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.profile_id = ?`, profileId);
  const accounts = new Set(wallets.map((w) => w.ledger_account_id));
  return { wallets, lines: lines.filter((l) => accounts.has(l.account)).map((l) => ({ ...l, t: Date.parse(l.at) })) };
}

export async function balance(db: LocalDb, profileId: string, q: LocalQuery, granularity: unknown): Promise<BalanceHistory> {
  let g = gran(granularity);
  const off = offsetOf(q);
  const { lines } = await walletLines(db, profileId, q);
  const all = (str(q.projectId) ? lines.filter((l) => l.project_id === q.projectId) : lines).sort((a, b) => a.t - b.t);
  let to = str(q.to) ? Date.parse(String(q.to)) : Date.now();
  let from = str(q.from) ? Date.parse(String(q.from)) : all[0]?.t ?? to - 30 * 86_400_000;
  if (from > to) [from, to] = [to, from];
  let bs = buckets(from, to, g, off);
  for (const coarser of ['week', 'month', 'year'] as const) {
    if (bs.length <= MAX_BUCKETS) break;
    g = coarser;
    bs = buckets(from, to, g, off);
  }
  const currencies = [...new Set(all.map((l) => l.currency))].sort().map((c) => {
    const mine = all.filter((l) => l.currency === c);
    const opening = mine.filter((l) => l.t < from).reduce((s, l) => s + l.amount, 0);
    let running = opening;
    let i = mine.findIndex((l) => l.t >= from);
    if (i < 0) i = mine.length;
    const points = bs.map((b, k) => {
      const end = bs[k + 1] ?? to + 1;
      for (let l = mine[i]; l && l.t < end && l.t <= to; l = mine[++i]) running += l.amount;
      return { period: label(b, g, off), start: isoAt(b, off), balance: minorToNumber(running, c) };
    });
    const closing = opening + mine.filter((l) => l.t >= from && l.t <= to).reduce((s, l) => s + l.amount, 0);
    return { currency: c, opening: minorToNumber(opening, c), closing: minorToNumber(closing, c), points };
  });
  return { granularity: g, from: new Date(from).toISOString(), to: new Date(to).toISOString(), currencies };
}

export async function walletPeriods(db: LocalDb, profileId: string, q: LocalQuery): Promise<WalletPeriod[]> {
  const { wallets, lines } = await walletLines(db, profileId, q);
  const to = str(q.to) ? Date.parse(String(q.to)) : Date.now();
  const from = str(q.from) ? Date.parse(String(q.from)) : undefined;
  return wallets.map((w): WalletPeriod => {
    const mine = lines.filter((l) => l.account === w.ledger_account_id && l.t <= to);
    const opening = from === undefined ? 0 : mine.filter((l) => l.t < from).reduce((s, l) => s + l.amount, 0);
    const closing = mine.reduce((s, l) => s + l.amount, 0);
    return { walletId: w.id, name: w.name, currency: w.currency, isArchived: !!w.is_archived, opening: minorToNumber(opening, w.currency), closing: minorToNumber(closing, w.currency) };
  }).filter((w) => !w.isArchived || w.opening !== 0 || w.closing !== 0);
}

export async function budgets(db: LocalDb, profileId: string, now = new Date()): Promise<BudgetStatus[]> {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const cats = await db.all<{ id: string; name: string; monthly_limit_minor: number; limit_currency: string | null }>(
    'SELECT id, name, monthly_limit_minor, limit_currency FROM categories WHERE profile_id = ? AND is_archived = 0 AND monthly_limit_minor IS NOT NULL', profileId);
  const spent = (await db.all<TxRecord>(
    'SELECT * FROM transactions WHERE profile_id = ? AND type = ? AND reversed_by_id IS NULL AND category_id IS NOT NULL', profileId, TxKind.Expense))
    .filter((t) => Date.parse(t.occurred_at) >= monthStart);
  return cats.map((c): BudgetStatus => {
    const cur = c.limit_currency ?? 'UZS';
    const s = spent.filter((t) => t.category_id === c.id && (t.to_currency ?? t.currency) === cur).reduce((a, t) => a + (t.to_amount_minor ?? t.amount_minor), 0);
    const limit = c.monthly_limit_minor;
    return {
      categoryId: c.id, name: c.name, currency: cur, limit: minorToNumber(limit, cur), spent: minorToNumber(s, cur),
      remaining: minorToNumber(limit - s, cur), percent: pct(s, limit, 1), exceeded: s > limit,
    };
  }).sort((a, b) => b.percent - a.percent);
}

/** GET /api/transactions: newest first, paged. */
export async function transactions(db: LocalDb, profileId: string, q: LocalQuery): Promise<{ items: Tx[]; total: number }> {
  const rows = (await filtered(db, profileId, q))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.created_at.localeCompare(a.created_at));
  const size = Math.min(200, Math.max(1, numOf(q.pageSize) ?? 50));
  const page = Math.max(1, numOf(q.page) ?? 1);
  return { items: rows.slice((page - 1) * size, page * size).map(txFromRow), total: rows.length };
}

/** Routes a read the screens would send to the server to the device's book; null = not answered locally. */
export async function localGet(db: LocalDb, profileId: string, path: string, q: LocalQuery = {}): Promise<unknown> {
  switch (path) {
    case '/api/analytics/summary': return summary(db, profileId, q);
    case '/api/analytics/timeseries': return timeSeries(db, profileId, q, q.granularity);
    case '/api/analytics/breakdown': return breakdown(db, profileId, q, q.by);
    case '/api/analytics/balance': return balance(db, profileId, q, q.granularity);
    case '/api/analytics/wallets': return walletPeriods(db, profileId, q);
    case '/api/analytics/budgets': return budgets(db, profileId);
    case '/api/transactions': return transactions(db, profileId, q);
    default: return null;
  }
}
