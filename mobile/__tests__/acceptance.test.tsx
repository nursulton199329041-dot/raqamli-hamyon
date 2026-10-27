import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { Dashboard } from '@/features/Dashboard';
import { FormSheets } from '@/features/FormSheets';
import { History } from '@/features/History';
import { OperationSheet } from '@/features/OperationSheet';
import { api } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, category, source } from '../test-utils/fakeServer';
import { useLayout } from '../test-utils/layout';
import { endpoint, renderApp, save, shownAmount, textOf, typeKeys } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.setTimeout(120000);

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer(); // empty account on a fresh, separate "database"
  server.categories = [category('c1', 'Kommunal'), category('c2', 'Oziq-ovqat')];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
});
afterEach(() => {
  jest.restoreAllMocks();
  restore();
});

/** waits until the wallet tile shows this balance (the same amount can also appear in totals, so scope to the tile) */
const balanceIs = (id: string, text: string) =>
  waitFor(() => expect(within(screen.getByTestId(`drag:wallet:${id}`)).getByText(text)).toBeTruthy());

const walletBy = (name: string) => server.wallets.find((w) => w.name === name)!;

/** Creates a wallet through the real "+" tile (or the empty-state button when there is none yet) and wallet form. */
async function createWallet(name: string, balance: string) {
  await fireEvent.press(screen.queryByLabelText('Yangi hamyon') ?? screen.getByLabelText('Yangi hamyon yaratish'));
  await fireEvent.changeText(await screen.findByLabelText('Ism'), name);
  await fireEvent.changeText(screen.getByLabelText(/^Boshlang‘ich balans/), balance);
  await fireEvent.press(screen.getByText('Saqlash'));
  await waitFor(() => expect(server.wallets.some((w) => w.name === name)).toBe(true));
  await waitFor(() => expect(useUi.getState().form).toBeNull());
}

describe('acceptance scenario (isolated fake ledger; real components, stores and query cache)', () => {
  it('1-18: create wallet, drag to a category, transfer, income, manual wallet choice, history, edit, reverse, analytics', async () => {
    await renderApp(<><Dashboard /><OperationSheet /><FormSheets /></>);
    await screen.findByText('Hali hamyon yo‘q. Birinchisini yarating.');

    // 1-2. a 5 000 000 wallet is created; its balance is shown under the icon
    await createWallet('Spark', '5000000');
    const spark = walletBy('Spark');
    await waitFor(() => expect(within(screen.getByTestId(`drag:wallet:${spark.id}`)).getByText('5 000 000 UZS')).toBeTruthy());

    // 7 (done early so all drop targets exist): second wallet
    await createWallet('Naqd', '0');
    const naqd = walletBy('Naqd');

    const L = useLayout({
      'dash-wrap': { x: 0, y: 0, w: 400, h: 800 },
      [`drag:wallet:${spark.id}`]: { x: 20, y: 300, w: 80, h: 70 },
      [`drop:wallet:${spark.id}`]: { x: 20, y: 300, w: 80, h: 70 },
      [`drag:wallet:${naqd.id}`]: { x: 120, y: 300, w: 80, h: 70 },
      [`drop:wallet:${naqd.id}`]: { x: 120, y: 300, w: 80, h: 70 },
      'drop:cat:c1': { x: 20, y: 600, w: 80, h: 70 },
      'drag:source:s1': { x: 20, y: 150, w: 80, h: 70 },
    }, { x: 0, y: 24 });

    // 3-6. drag Spark onto Kommunal, spend 150 000
    await L.drag(`drag:wallet:${spark.id}`, { x: 10, y: 10 }, [{ tx: 30, ty: 300 }]);
    expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: spark.id, categoryId: 'c1' });
    expect(server.pushes).toHaveLength(0);
    await typeKeys('150000');
    await save();
    await waitFor(() => expect(server.pushes).toHaveLength(1));
    await balanceIs(spark.id, '4 850 000 UZS'); // 5. balance 4 850 000
    await waitFor(() => expect(textOf('section-expense-total')).toBe('150 000 UZS')); // 6. Kommunal +150 000
    expect(within(screen.getByTestId('drop:cat:c1')).getByText('150 000 UZS')).toBeTruthy();

    // 8-9. transfer 200 000 from the first wallet to the second by dragging wallet onto wallet
    await L.drag(`drag:wallet:${spark.id}`, { x: 10, y: 10 }, [{ tx: 110, ty: 10 }]);
    expect(useUi.getState().op).toEqual({ kind: 'transfer', walletId: spark.id, toWalletId: naqd.id });
    await typeKeys('200000');
    await save();
    await balanceIs(spark.id, '4 650 000 UZS');
    await balanceIs(naqd.id, '200 000 UZS');

    // 10. income source -> wallet: 1 000 000 into the first wallet
    await L.drag('drag:source:s1', { x: 5, y: 5 }, [{ tx: 20, ty: 160 }]);
    expect(useUi.getState().op).toEqual({ kind: 'income', walletId: spark.id, sourceId: 's1' });
    await typeKeys('1000000');
    await save();
    await balanceIs(spark.id, '5 650 000 UZS');

    // (a tap right after a drag is deliberately ignored for 400 ms, so releasing on the origin tile cannot also open it)

    await new Promise((r) => setTimeout(r, 450));

    // 11. income with the wallet chosen by hand (tap the source, pick the wallet in the picker)
    await fireEvent.press(within(screen.getByTestId('drag:source:s1')).getByText('Maosh'));
    expect(useUi.getState().op).toEqual({ kind: 'income', sourceId: 's1' });
    await fireEvent.press(await screen.findByTestId('to-endpoint'));
    await fireEvent.press(await within(screen.getByTestId('sheet-scroll')).findByLabelText(/^Naqd/));
    expect(await endpoint('to-endpoint').findByText('Naqd')).toBeTruthy();
    await typeKeys('100000+50000');
    expect(shownAmount()).toBe('150 000');
    await save();
    await waitFor(() => expect(naqd.balance).toBe(350_000));
    await balanceIs(naqd.id, '350 000 UZS');

    // 15 (dashboard part): income section total = 1 000 000 + 150 000
    await waitFor(() => expect(textOf('section-income-total')).toBe('1 150 000 UZS'));

    // ledger sanity on the "database": 4 operations, wallets as expected
    expect(server.txs.filter((t) => t.type !== 9)).toHaveLength(4);
    expect([spark.balance, naqd.balance]).toEqual([5_650_000, 350_000]);

    // 12-14. history: operations are listed; edit one; reverse another
    await cleanup();
    await renderApp(<><History /><OperationSheet /></>);
    await screen.findByTestId('saldo');
    await waitFor(() => expect(screen.queryAllByTestId(/^tx-/)).toHaveLength(4));
    await waitFor(() => expect(textOf('inflow')).toBe('1 150 000 UZS'));
    expect(textOf('outflow')).toBe('150 000 UZS');

    const expense = server.txs.find((t) => t.type === 2)!;
    await fireEvent.press(screen.getByTestId(`tx-${expense.id}`));
    expect(shownAmount()).toBe('150 000');
    await typeKeys('C120000');
    await save();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    await waitFor(() => expect(useUi.getState().op).toBeNull());
    expect(spark.balance).toBe(5_680_000); // 30 000 given back by the correction
    await waitFor(() => expect(textOf('outflow')).toBe('120 000 UZS'));

    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[1]?.onPress?.(); });
    const transfer = server.txs.find((t) => t.type === 3)!;
    await fireEvent.press(screen.getByTestId(`tx-${transfer.id}`));
    await fireEvent.press(await screen.findByTestId('trash'));
    await waitFor(() => expect(server.reversed).toContain(transfer.id));
    expect(spark.balance).toBe(5_880_000); // 200 000 back
    expect(naqd.balance).toBe(150_000);

    // 15. analytics (backend breakdown/summary) reflect the corrections; reversed entries are excluded
    const rows = await api.get<{ id: string; total: number }[]>('/api/analytics/breakdown', { by: 'category', type: 2 });
    expect(rows).toEqual([expect.objectContaining({ id: 'c1', total: 120000 })]);
    const sum = await api.get<{ totals: { income: number; expense: number; netFlow: number }[] }>('/api/analytics/summary', {});
    expect(sum.totals[0]).toMatchObject({ income: 1_150_000, expense: 120_000, netFlow: 1_030_000 });
  });
});
