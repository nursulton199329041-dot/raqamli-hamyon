import type { BreakdownRow, Category, Tx } from '@/api/types';
import { TxType } from '@/api/types';
import { minorToNumber, toMinor } from '@/local/money';

/** One line of the grouped expense list: a top-level category with everything spent in it and its sub-categories. */
export interface CategoryGroup {
  /** top-level category id; null = expenses without a category */
  id: string | null;
  name: string;
  icon: string;
  color: string;
  currency: string;
  total: number;
  count: number;
  percent: number;
}

/**
 * Groups the expense breakdown (one row per category the server or the device book already summed, in the currency
 * the money was spent in) by top-level category id — never by name. A sub-category joins its parent. Only rows of
 * `currency` are used: other currencies are never added in. Sums are made in minor units, so 0.1 + 0.2 stays exact.
 */
export function groupByCategory(rows: BreakdownRow[], categories: Category[], currency: string): CategoryGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const top = (id: string | null) => {
    let c = id ? byId.get(id) : undefined;
    for (let hops = 0; c?.parentId && byId.has(c.parentId) && hops < 8; hops++) c = byId.get(c.parentId);
    return c;
  };
  const groups = new Map<string, { id: string | null; cat?: Category; name: string; minor: number; count: number }>();
  for (const r of rows) {
    if (r.currency !== currency) continue;
    const c = top(r.id);
    const id = c?.id ?? r.id;
    const key = id ?? '';
    const g = groups.get(key) ?? { id, cat: c, name: c?.name ?? r.name, minor: 0, count: 0 };
    g.minor += toMinor(String(r.total), currency);
    g.count += r.count;
    groups.set(key, g);
  }
  const all = [...groups.values()];
  const total = all.reduce((s, g) => s + g.minor, 0);
  return all
    .sort((a, b) => b.minor - a.minor || a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.id, name: g.name, icon: g.cat?.icon ?? 'tag', color: g.cat?.color ?? '#94A3B8', currency,
      total: minorToNumber(g.minor, currency), count: g.count,
      percent: total === 0 ? 0 : Math.round((g.minor / total) * 1000) / 10,
    }));
}

/** What an expense cost in the currency it was spent in (a dollar card paying in sums: the stored sum amount). */
export function spent(tx: Tx): { amount: number; currency: string } {
  return tx.type === TxType.Expense && tx.toAmount != null && tx.toCurrency
    ? { amount: tx.toAmount, currency: tx.toCurrency }
    : { amount: tx.amount, currency: tx.currency };
}
