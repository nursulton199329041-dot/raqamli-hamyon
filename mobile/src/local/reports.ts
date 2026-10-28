import type { LocalDb } from './db';
import { TxKind } from './ledger';

export interface LocalTotals {
  currency: string; income: number; expense: number; net: number;
  borrowed: number; lent: number; repaid: number; collected: number;
}

/**
 * Per-currency totals from the local book (minor units), same rules as the backend summary: reversed entries and
 * reversals are excluded, transfers / openings / adjustments are not activity, debts are reported apart from income and
 * expense, and an expense paid in another currency counts in the currency it was spent in. Currencies are never summed.
 */
export async function localSummary(db: LocalDb, profileId: string, from?: string, to?: string): Promise<LocalTotals[]> {
  const rows = await db.all<{ type: number; currency: string; amount: number }>(
    `SELECT type,
            CASE WHEN type = ? AND to_currency IS NOT NULL THEN to_currency ELSE currency END AS currency,
            SUM(CASE WHEN type = ? AND to_amount_minor IS NOT NULL THEN to_amount_minor ELSE amount_minor END) AS amount
     FROM transactions
     WHERE profile_id = ? AND reversed_by_id IS NULL AND type <> ?
       AND (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at <= ?)
     GROUP BY 1, 2`,
    TxKind.Expense, TxKind.Expense, profileId, TxKind.Reversal, from ?? null, from ?? null, to ?? null, to ?? null);
  const by = new Map<string, LocalTotals>();
  const get = (c: string) => {
    let t = by.get(c);
    if (!t) by.set(c, (t = { currency: c, income: 0, expense: 0, net: 0, borrowed: 0, lent: 0, repaid: 0, collected: 0 }));
    return t;
  };
  const field: Partial<Record<number, keyof LocalTotals>> = {
    [TxKind.Income]: 'income', [TxKind.Expense]: 'expense', [TxKind.DebtBorrow]: 'borrowed', [TxKind.DebtLend]: 'lent',
    [TxKind.DebtRepayment]: 'repaid', [TxKind.DebtCollection]: 'collected',
  };
  for (const r of rows) {
    const f = field[r.type]; // transfers, openings and adjustments are not activity
    if (f) (get(r.currency)[f] as number) += r.amount;
  }
  const out = [...by.values()];
  for (const t of out) t.net = t.income - t.expense;
  return out.sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Books check: every account balance equals the sum of its entries, and each profile's entries net to zero per currency. */
export async function ledgerCheck(db: LocalDb, profileId: string) {
  const mismatched = await db.all<{ id: string }>(
    `SELECT a.id FROM ledger_accounts a
     LEFT JOIN (SELECT ledger_account_id, SUM(amount_minor) AS s FROM transaction_entries GROUP BY ledger_account_id) e ON e.ledger_account_id = a.id
     WHERE a.profile_id = ? AND a.balance_minor <> COALESCE(e.s, 0)`, profileId);
  const net = await db.all<{ currency: string; s: number }>(
    'SELECT currency, SUM(amount_minor) AS s FROM transaction_entries WHERE profile_id = ? GROUP BY currency HAVING SUM(amount_minor) <> 0', profileId);
  return { ok: mismatched.length === 0 && net.length === 0, mismatched: mismatched.map((m) => m.id), unbalanced: net };
}
