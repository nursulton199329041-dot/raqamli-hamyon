import type { BreakdownRow, Category, Tx } from '@/api/types';
import { groupByCategory, spent } from '@/lib/categoryGroups';

const cat = (id: string, name: string, parentId: string | null = null, isArchived = false): Category =>
  ({ id, name, icon: 'tag', color: '#f00', parentId, isArchived, sortOrder: 0 });
const row = (id: string | null, total: number, count: number, currency = 'UZS'): BreakdownRow =>
  ({ id, name: id ?? '—', currency, total, percent: 0, count });

describe('expenses grouped by category', () => {
  const cats = [cat('oylik', 'Oylik'), cat('food', 'Oziq-ovqat'), cat('bread', 'Non', 'food'), cat('tel', 'Telefon va internet'),
    cat('old', 'Eski', null, true), cat('twin', 'Oziq-ovqat')];

  it('one line per top-level category id: sub-categories join their parent, count and total add up', () => {
    const g = groupByCategory([row('oylik', 83_000_000, 2), row('food', 60_000, 1), row('bread', 30_000, 1), row('tel', 25_000, 1)], cats, 'UZS');
    expect(g.map((x) => [x.name, x.total, x.count])).toEqual([
      ['Oylik', 83_000_000, 2], ['Oziq-ovqat', 90_000, 2], ['Telefon va internet', 25_000, 1],
    ]);
    expect(g.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100, 0);
  });

  it('groups by id, never by name: two categories called the same stay apart; archived ones keep their line', () => {
    const g = groupByCategory([row('food', 10, 1), row('twin', 20, 1), row('old', 5, 1)], cats, 'UZS');
    expect(g.map((x) => x.id)).toEqual(['twin', 'food', 'old']);
  });

  it('currencies are never added: only the report currency is used; sums are exact', () => {
    const g = groupByCategory([row('food', 0.1, 1, 'USD'), row('bread', 0.2, 1, 'USD'), row('food', 90_000, 1)], cats, 'USD');
    expect(g).toEqual([expect.objectContaining({ id: 'food', total: 0.3, count: 2, currency: 'USD', percent: 100 })]);
  });

  it('expenses without a category get their own line', () => {
    expect(groupByCategory([row(null, 5_000, 1)], cats, 'UZS')).toEqual([expect.objectContaining({ id: null, total: 5_000 })]);
  });

  it('a dollar card paying in sums counts in sums (the amount stored at the confirmed rate)', () => {
    const tx = { type: 2, amount: 10, currency: 'USD', toAmount: 120_000, toCurrency: 'UZS' } as Tx;
    expect(spent(tx)).toEqual({ amount: 120_000, currency: 'UZS' });
    expect(spent({ type: 3, amount: 10, currency: 'USD', toAmount: 121_000, toCurrency: 'UZS' } as Tx)).toEqual({ amount: 10, currency: 'USD' });
  });
});
