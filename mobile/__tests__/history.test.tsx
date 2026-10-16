import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { History } from '@/features/History';
import { OperationSheet } from '@/features/OperationSheet';
import { api } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { renderApp, shownAmount, textOf, typeKeys, save } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.setTimeout(30000);

let server: FakeServer;
let restore: () => void;

const push = (kind: string, payload: Record<string, unknown>) =>
  api.post('/api/sync/push', { operations: [{ clientOperationId: `${kind}-${Math.random()}`, kind, payload }] });
const at = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

beforeEach(async () => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Bank kartasi', 5_000_000), wallet('w2', 'Dollar', 100, { currency: 'USD', icon: 'cash' }), wallet('w3', 'Naqd', 0)];
  server.categories = [category('c1', 'Kommunal'), category('c1a', 'Svet', { parentId: 'c1' })];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
  await push('expense', { walletId: 'w1', amount: 150000, categoryId: 'c1a', occurredAt: at(1), memo: 'Svet puli' });
  await push('expense', { walletId: 'w1', amount: 50000, categoryId: 'c1', occurredAt: at(1) });
  await push('income', { walletId: 'w1', amount: 1000000, incomeSourceId: 's1', occurredAt: at(0) });
  await push('transfer', { fromWalletId: 'w1', toWalletId: 'w2', amount: 1200000, toAmount: 100, occurredAt: at(0) });
});
afterEach(() => {
  jest.restoreAllMocks();
  restore();
});

describe('history (reference layout)', () => {
  it('8. header totals, day groups with daily totals, rows with title / wallet / memo / amount', async () => {
    await renderApp(<><History /><OperationSheet /></>);
    await screen.findByTestId('saldo');
    // header: balance = inflow - outflow of the month, from the backend summary (reversed entries excluded)
    await waitFor(() => expect(textOf('inflow')).toBe('1 000 000 UZS'));
    expect(textOf('outflow')).toBe('200 000 UZS');
    expect(textOf('saldo')).toBe('800 000 UZS');
    expect(screen.getByText('Operatsiyalar ro‘yxati')).toBeTruthy();

    // two day groups: today (income +1 000 000, transfer neutral) and yesterday (-200 000)
    const days = screen.getAllByTestId(/^day-h/);
    expect(days).toHaveLength(2);
    expect(within(days[0]!).getByText('1 000 000 UZS')).toBeTruthy();
    expect(within(days[1]!).getByText('−200 000 UZS')).toBeTruthy();

    // rows
    const sub = server.txs.find((t) => t.categoryId === 'c1a')!;
    const row = within(screen.getByTestId(`tx-${sub.id}`));
    expect(row.getByText('Kommunal / Svet')).toBeTruthy(); // category / sub-category
    expect(row.getByText('Bank kartasi')).toBeTruthy();
    expect(row.getByText('Svet puli')).toBeTruthy();
    expect(row.getByText('−150 000 UZS')).toBeTruthy();

    const tr = server.txs.find((t) => t.type === 3)!;
    const trRow = within(screen.getByTestId(`tx-${tr.id}`));
    expect(trRow.getByText('Transfer')).toBeTruthy();
    expect(trRow.getByText('Bank kartasi → Dollar')).toBeTruthy();
    expect(trRow.getByText('1 200 000 UZS')).toBeTruthy();
    expect(trRow.getByText('100 USD')).toBeTruthy(); // received amount in the other currency
  });

  it('search filters by note; the period arrows move month by month', async () => {
    await renderApp(<><History /><OperationSheet /></>);
    await screen.findByTestId('saldo');
    const input = screen.getByLabelText('Qidirish');
    await fireEvent.changeText(input, 'Svet');
    await fireEvent(input, 'submitEditing');
    await waitFor(() => expect(screen.queryAllByTestId(/^tx-/)).toHaveLength(1));

    await fireEvent.changeText(input, '');
    await fireEvent(input, 'submitEditing');
    await waitFor(() => expect(screen.queryAllByTestId(/^tx-/).length).toBeGreaterThan(1));
    await fireEvent.press(screen.getByTestId('prev-period'));
    await screen.findByText('Hali operatsiya yo‘q');
    expect(textOf('saldo')).toBe('0 UZS');
    await fireEvent.press(screen.getByTestId('next-period'));
    await waitFor(() => expect(screen.queryAllByTestId(/^tx-/).length).toBeGreaterThan(1));
  });

  it('13. tapping an operation opens it for editing; saving corrects it (PUT) and the list/balances follow', async () => {
    await renderApp(<><History /><OperationSheet /></>);
    await screen.findByTestId('saldo');
    const sub = server.txs.find((t) => t.categoryId === 'c1a')!;
    await fireEvent.press(await screen.findByTestId(`tx-${sub.id}`));
    expect(useUi.getState().op?.edit?.id).toBe(sub.id);
    expect(await screen.findByTestId('trash')).toBeTruthy();
    expect(shownAmount()).toBe('150 000');
    expect(screen.getByLabelText('Izoh').props.value).toBe('Svet puli');

    await typeKeys('C100000');
    await save();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    await waitFor(() => expect(useUi.getState().op).toBeNull());
    // old entry stays in history as reversed, a new entry replaces it: outflow now 100 000 + 50 000
    await waitFor(() => expect(textOf('outflow')).toBe('150 000 UZS'));
  });

  it('14. reversing from the edit sheet asks first, restores the balance and keeps the entry visible as reversed', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[1]?.onPress?.(); });
    await renderApp(<><History /><OperationSheet /></>);
    await screen.findByTestId('saldo');
    const tx = server.txs.find((t) => t.categoryId === 'c1')!;
    const before = server.wallets[0]!.balance;
    await fireEvent.press(await screen.findByTestId(`tx-${tx.id}`));
    await fireEvent.press(await screen.findByTestId('trash'));
    await waitFor(() => expect(server.reversed).toContain(tx.id));
    expect(server.wallets[0]!.balance).toBe(before + 50000);
    await waitFor(() => expect(textOf('outflow')).toBe('150 000 UZS'));
    // the reversed entry is still listed (struck through, labelled) - the ledger is never rewritten
    expect(within(screen.getByTestId(`tx-${tx.id}`)).getByText('Bekor qilingan')).toBeTruthy();
  });

  it('the + button opens an empty expense sheet; the filter sheet narrows by operation type', async () => {
    await renderApp(<><History /><OperationSheet /></>);
    await screen.findByTestId('saldo');
    await fireEvent.press(screen.getByTestId('filter-button'));
    await fireEvent.press(await screen.findByLabelText('Transfer'));
    await waitFor(() => expect(screen.queryAllByTestId(/^tx-/)).toHaveLength(1));
    await act(async () => { await fireEvent.press(screen.getByTestId('fab-add')); });
    expect(useUi.getState().op).toEqual({ kind: 'expense' });
  });
});
