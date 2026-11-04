import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { fileNameOf } from '@/api/client';
import { lineLayout, niceScale, signedLayout } from '@/design/charts';
import { Reports, axisLabel, pointTitle } from '@/features/reports/Reports';
import { ALL_KEYS, LANGS, translate } from '@/i18n';
import { compactMoney, fmtMoney } from '@/lib/money';
import { rangeLabel, resolveRange, shiftAnchor, toQuery, type ReportFilter } from '@/lib/reportFilter';
import { api } from '@/state/runtime';
import { useReports } from '@/state/reports';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
const mockWritten: { name: string; bytes: number }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class {
    exists = false;
    uri: string;
    name: string;
    constructor(_dir: string, name: string) { this.name = name; this.uri = `file://${name}`; }
    create() {}
    delete() {}
    write(b: Uint8Array) { mockWritten.push({ name: this.name, bytes: b.length }); }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));
jest.setTimeout(30000);

const NB = ' '; // narrow no-break space: thousands separator for uz / ru

describe('report period', () => {
  const oct = (d: number) => new Date(2026, 9, d, 12).toISOString();

  it('month, week (Monday first), year and custom ranges resolve in the local calendar', () => {
    const m = resolveRange({ preset: 'month', anchor: oct(15) });
    expect([m.from.getDate(), m.to.getDate(), m.to.getHours(), m.days, m.granularity]).toEqual([1, 31, 23, 31, 'day']);
    const w = resolveRange({ preset: 'week', anchor: oct(28) }); // Wednesday
    expect([w.from.getDay(), w.from.getDate(), w.to.getMonth(), w.to.getDate(), w.days]).toEqual([1, 26, 10, 1, 7]);
    expect(resolveRange({ preset: 'year', anchor: oct(1) })).toMatchObject({ days: 365, granularity: 'month' });
    expect(resolveRange({ preset: 'custom', anchor: oct(1), customFrom: '2026-10-01', customTo: '2026-10-27' })).toMatchObject({ days: 27, granularity: 'day' });
    expect(resolveRange({ preset: 'custom', anchor: oct(1), customFrom: '2026-01-01', customTo: '2026-06-30' }).granularity).toBe('month');
    // reversed custom dates are swapped, not rejected
    expect(resolveRange({ preset: 'custom', anchor: oct(1), customFrom: '2026-10-27', customTo: '2026-10-01' }).days).toBe(27);
  });

  it('previous / next period and labels in three languages', () => {
    const f = { preset: 'month' as const, anchor: oct(15) };
    expect(new Date(shiftAnchor(f, -1)).getMonth()).toBe(8);
    expect(new Date(shiftAnchor({ preset: 'year', anchor: oct(15) }, 1)).getFullYear()).toBe(2027);
    expect(rangeLabel('uz', f)).toBe('oktabr 2026');
    expect(rangeLabel('ru', f)).toBe('октябрь 2026'); // nominative when the month stands alone
    expect(rangeLabel('en', f)).toBe('October 2026');
    expect(rangeLabel('ru', { preset: 'day', anchor: oct(27) })).toBe('27 октября 2026');
    expect(pointTitle('ru', '2026-10-05', 'day')).toBe('5 октября 2026');
    expect(axisLabel('en', '2026-10', 'month')).toBe('Oct');
  });

  it('one query for every widget: the most specific category wins, the client offset is sent', () => {
    const f: ReportFilter = { kind: 'expense', preset: 'month', anchor: oct(15), categoryId: 'c1', subCategoryId: 'c1a', currency: 'UZS', walletId: 'w1' };
    const q = toQuery(f);
    expect(q).toMatchObject({ categoryId: 'c1a', currency: 'UZS', walletId: 'w1', from: new Date(2026, 9, 1).toISOString() });
    expect(typeof q.tz).toBe('number');
  });
});

describe('axes stay readable', () => {
  it('nice ticks: round steps, negative ranges and the all-zero case', () => {
    expect(niceScale(0, 3_333_333).ticks).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000]);
    const neg = niceScale(-1_250_000, 2_000_000);
    expect(neg.lo).toBeLessThanOrEqual(-1_250_000);
    expect(neg.ticks).toContain(0);
    expect(niceScale(0, 0).ticks).toEqual([0, 1]);
    expect(niceScale(0, 950_000_000_000).hi).toBeGreaterThanOrEqual(950_000_000_000);
  });

  it('negative net flow is drawn below the zero line; a negative balance includes zero', () => {
    const g = signedLayout([{ label: 'a', value: 500 }, { label: 'b', value: -300 }], 300, 200);
    const zero = g.grid.find((x) => x.zero)!;
    const neg = g.bars.find((b) => b.kind === 'negative')!;
    expect(Math.round(neg.y)).toBe(Math.round(zero.y));
    expect(g.bars.find((b) => b.kind === 'positive')!.y + g.bars.find((b) => b.kind === 'positive')!.h).toBeCloseTo(zero.y, 0);
    const line = lineLayout([{ label: 'a', value: 200 }, { label: 'b', value: -150 }], 300, 200);
    expect(line.grid.some((x) => x.zero)).toBe(true);
    expect(line.grid.map((x) => x.label.text)).toContain('−200');
  });

  it('a balance far from zero hugs the data instead of flattening against 0', () => {
    const g = lineLayout([{ label: 'a', value: 38_000_000 }, { label: 'b', value: 39_000_000 }], 300, 200);
    expect(g.grid.some((x) => x.zero)).toBe(false);
  });
});

describe('number formats follow the language', () => {
  afterEach(() => useSettings.setState({ lang: 'uz' }));

  it.each([
    ['uz', `1${NB}234${NB}567,50 USD`, '1,6 mln', '12 ming', '2 mlrd'],
    ['ru', `1${NB}234${NB}567,50 USD`, '1,6 млн', '12 тыс.', '2 млрд'],
    ['en', '1,234,567.50 USD', '1.6M', '12K', '2B'],
  ] as const)('%s', (lang, full, mln, k, b) => {
    useSettings.setState({ lang });
    expect(fmtMoney(1_234_567.5, 'USD')).toBe(full);
    expect(compactMoney(1_600_000)).toBe(mln);
    expect(compactMoney(12_000)).toBe(k);
    expect(compactMoney(2_000_000_000)).toBe(b);
    expect(compactMoney(-1_600_000).startsWith('−')).toBe(true);
  });
});

describe('translations', () => {
  it('every key has a non-empty UZ / RU / EN text with the same placeholders', () => {
    for (const key of ALL_KEYS) {
      const texts = LANGS.map((l) => translate(l, key));
      texts.forEach((x) => expect(x.trim().length).toBeGreaterThan(0));
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(new Set(texts.map(ph)).size).toBe(1);
    }
  });

  it('export file name is read from Content-Disposition (UTF-8 names included)', () => {
    expect(fileNameOf('attachment; filename=RaqamliHamyon_2026-10_Oylik.xlsx; filename*=UTF-8\'\'RaqamliHamyon_2026-10_Oylik.xlsx'))
      .toBe('RaqamliHamyon_2026-10_Oylik.xlsx');
    expect(fileNameOf("attachment; filename*=UTF-8''RaqamliHamyon_2026-10_%D0%9C%D0%B5%D1%81%D1%8F%D1%86.xlsx")).toBe('RaqamliHamyon_2026-10_Месяц.xlsx');
    expect(fileNameOf('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(fileNameOf(null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ screen

describe('reports screen', () => {
  let server: FakeServer;
  let restore: () => void;
  const now = new Date();
  const at = (dayOffset: number) => new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - dayOffset), 10).toISOString();

  beforeEach(() => {
    useSettings.setState({ lang: 'uz', reduceEffects: true });
    useSession.setState({ user: { id: 'u', email: 'e', displayName: 'D', locale: 'uz', defaultCurrency: 'UZS', theme: 'dark' } } as never);
    useReports.setState({ filter: { kind: 'expense', preset: 'month', anchor: now.toISOString() } });
    server = new FakeServer();
    server.wallets = [wallet('w1', 'Karta', 4_000_000), wallet('w2', 'Naqd', 1_000_000), wallet('w3', 'Dollar', 300, { currency: 'USD' })];
    server.categories = [category('c1', 'Oziq'), category('c1a', 'Non', { parentId: 'c1' }), category('c2', 'Transport')];
    server.sources = [source('s1', 'Maosh')];
    const base = { createdAt: now.toISOString(), currency: 'UZS', memo: null };
    server.txs = [
      { ...base, id: 't1', type: 1, amount: 2_000_000, walletId: 'w1', incomeSourceId: 's1', occurredAt: at(0) },
      { ...base, id: 't2', type: 2, amount: 300_000, walletId: 'w1', categoryId: 'c1', occurredAt: at(0) },
      { ...base, id: 't3', type: 2, amount: 100_000, walletId: 'w1', categoryId: 'c1a', occurredAt: at(0) },
      { ...base, id: 't4', type: 3, amount: 1_000_000, walletId: 'w1', toWalletId: 'w2', occurredAt: at(0) }, // transfer
      { ...base, id: 't5', type: 4, amount: 700_000, walletId: 'w1', personId: 'p1', occurredAt: at(0) }, // borrowed
      { ...base, id: 't6', type: 1, amount: 50, walletId: 'w3', currency: 'USD', incomeSourceId: 's1', occurredAt: at(0) },
    ] as never;
    server.debtPositions = [{ currency: 'UZS', iOwe: 700_000, owedToMe: 0 }];
    restore = server.install();
  });
  afterEach(() => {
    restore();
    useSettings.setState({ lang: 'uz' });
  });

  const stat = (k: string) => screen.getByTestId(`stat-${k}-value`);

  it('expense report: totals exclude transfers and debts; operations are grouped once per category and open on tap', async () => {
    await renderApp(<Reports />);
    await waitFor(() => expect(stat('expense')).toHaveTextContent(`400${NB}000 UZS`));
    expect(stat('top-category')).toHaveTextContent('c1'); // fake breakdown names rows by id
    const list = await screen.findByTestId('category-groups');
    // the sub-category "Non" (c1a) joins its parent "Oziq": one line, both operations, one total
    const group = await within(list).findByTestId('cg-c1');
    expect(group).toHaveTextContent(/^Oziq/);
    expect(group).toHaveTextContent(/2 operatsiya/);
    expect(group).toHaveTextContent(/400\s000 UZS/);
    expect(within(list).queryByTestId('cg-c1a')).toBeNull();
    expect(within(list).queryByTestId('cg-tx-t2')).toBeNull(); // closed until tapped

    await fireEvent.press(group);
    const ops = await within(list).findByTestId('cg-ops-c1');
    await waitFor(() => expect(within(ops).getByTestId('cg-tx-t2')).toBeTruthy());
    expect(within(ops).getByTestId('cg-tx-t3')).toHaveTextContent(/Non/); // the sub-category is named
    expect(within(ops).getByTestId('cg-tx-t3')).toHaveTextContent(/Karta/); // and the wallet
    for (const id of ['t1', 't4', 't5']) expect(within(ops).queryByTestId(`cg-tx-${id}`)).toBeNull(); // income, transfer, debt

    await fireEvent.press(within(ops).getByTestId('cg-tx-t3'));
    expect(await screen.findByText(`Xarajat · 100${NB}000 UZS`)).toBeTruthy(); // the operation's details

    await fireEvent.press(group); // closes again
    await waitFor(() => expect(within(list).queryByTestId('cg-ops-c1')).toBeNull());
  });

  it('switching the report type and the currency recomputes everything from the same filter', async () => {
    await renderApp(<Reports />);
    await fireEvent.press(await screen.findByTestId('open-filters'));
    await fireEvent.press(await screen.findByTestId('kind-compare'));
    await waitFor(() => expect(stat('income')).toHaveTextContent(`2${NB}000${NB}000 UZS`));
    expect(stat('net')).toHaveTextContent(`+1${NB}600${NB}000 UZS`);
    expect(stat('savings')).toHaveTextContent('80%');
    await fireEvent.press(screen.getByLabelText('USD'));
    await waitFor(() => expect(stat('income')).toHaveTextContent('50 USD')); // never added to UZS
  });

  it('a wallet filter narrows statistics and list; clearing it restores them', async () => {
    useReports.setState({ filter: { kind: 'compare', preset: 'month', anchor: now.toISOString(), walletId: 'w2' } });
    await renderApp(<Reports />);
    await waitFor(() => expect(stat('income')).toHaveTextContent('0 UZS')); // w2 only received a transfer
    await fireEvent.press(screen.getByTestId('clear-walletId'));
    await waitFor(() => expect(stat('income')).toHaveTextContent(`2${NB}000${NB}000 UZS`));
  });

  it('balance history and debt reports use ledger balances and debt rules', async () => {
    useReports.setState({ filter: { kind: 'balance', preset: 'month', anchor: now.toISOString() } });
    await renderApp(<Reports />);
    await waitFor(() => expect(stat('closing')).toHaveTextContent(`5${NB}000${NB}000 UZS`));
    await fireEvent.press(screen.getByTestId('open-filters'));
    await fireEvent.press(await screen.findByTestId('kind-debts'));
    await fireEvent.press(screen.getByTestId('close-filters'));
    await waitFor(() => expect(stat('i-owe')).toHaveTextContent(`700${NB}000 UZS`));
    expect(stat('borrowed')).toHaveTextContent(`700${NB}000 UZS`);
  });

  it('empty period shows an empty state instead of a broken chart', async () => {
    useReports.setState({ filter: { kind: 'expense', preset: 'year', anchor: new Date(2001, 5, 1).toISOString() } });
    await renderApp(<Reports />);
    expect((await screen.findAllByText('Bu davr uchun ma’lumot yo‘q')).length).toBeGreaterThan(0);
    expect(stat('expense')).toHaveTextContent('0 UZS');
  });

  it('tapping the chart shows date, value and currency', async () => {
    useReports.setState({ filter: { kind: 'compare', preset: 'month', anchor: now.toISOString() } });
    await renderApp(<Reports />);
    const box = await screen.findByTestId('main-chart');
    await fireEvent(box, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 200 } } });
    const touch = await screen.findByTestId('chart-touch');
    await act(async () => { touch.props.onResponderGrant({ nativeEvent: { locationX: 359 } }); });
    const tip = await screen.findByTestId('chart-tooltip');
    expect(tip).toHaveTextContent(/UZS/);
    expect(tip).toHaveTextContent(/Kirim/);
  });


  it.each([
    ['uz', 'Hisobot', 'Xarajatlar', 'Jami xarajat'],
    ['ru', 'Отчёты', 'Расходы', 'Всего расходов'],
    ['en', 'Reports', 'Expenses', 'Total expenses'],
  ] as const)('the whole screen follows the language: %s', async (lang, title, kind, statLabel) => {
    useSettings.setState({ lang });
    await renderApp(<Reports />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getAllByText(kind).length).toBeGreaterThan(0);
    expect(screen.getByText(statLabel)).toBeTruthy();
    await waitFor(() => expect(stat('expense')).toHaveTextContent(lang === 'en' ? '400,000 UZS' : `400${NB}000 UZS`));
  });
});
