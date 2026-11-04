import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { loadSavedRate, officialRate, saveRate } from '@/lib/rates';
import { OperationSheet } from '@/features/OperationSheet';
import { History } from '@/features/History';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { category, FakeServer, wallet } from '../test-utils/fakeServer';
import { renderApp, save, textOf, typeKeys } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/rates', () => ({ ...jest.requireActual('@/lib/rates'), officialRate: jest.fn() }));
jest.setTimeout(30000);

const rate = officialRate as jest.MockedFunction<typeof officialRate>;

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  rate.mockReset();
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [wallet('usd', 'Dollar', 500, { currency: 'USD' }), wallet('uzs', 'Karta', 1_000_000)];
  server.categories = [category('c1', 'Kommunal')];
  restore = server.install();
});
afterEach(() => restore());

async function openExpense(walletId: string) {
  await renderApp(<OperationSheet />);
  await act(async () => { useUi.getState().openOp({ kind: 'expense', walletId, categoryId: 'c1' }); });
  await screen.findByTestId('amount-display');
}

describe('an expense from a wallet in another currency', () => {
  it('shows the sum at the official rate and saves both: dollars leave the wallet, the expense is in sums', async () => {
    rate.mockResolvedValue(11941.65);
    await openExpense('usd');
    await typeKeys('10');

    await waitFor(() => expect(textOf('amount-to-display')).toBe('119 416,5 UZS'));
    expect(textOf('rate-line')).toContain('1 USD = 11');
    await save();

    await waitFor(() => expect(server.pushes.length).toBe(1));
    expect(server.pushes[0]).toMatchObject({ kind: 'expense' });
    expect(server.pushes[0]!.payload).toMatchObject({
      walletId: 'usd', amount: 10, categoryId: 'c1', toCurrency: 'UZS', toAmount: 119416.5, rateSource: 'cbu', rateDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(server.wallets.find((w) => w.id === 'usd')!.balance).toBe(490);
  });

  it('a typed sum wins over the rate and is marked as entered by hand', async () => {
    rate.mockResolvedValue(11941.65);
    await openExpense('usd');
    await typeKeys('10');
    await screen.findByTestId('amount-to-display');
    await fireEvent.press(screen.getByTestId('amount-to-display'));
    await typeKeys('C120000');
    await save();

    await waitFor(() => expect(server.pushes.length).toBe(1));
    expect(server.pushes[0]!.payload).toMatchObject({ toAmount: 120000, rateSource: 'manual' });
  });

  it('no rate available: nothing is saved until the sum is entered', async () => {
    rate.mockResolvedValue(null);
    await openExpense('usd');
    await typeKeys('10');
    await save();

    await screen.findByText(/Kurs topilmadi/);
    expect(server.pushes.length).toBe(0);
    await typeKeys('120000');
    await save();
    await waitFor(() => expect(server.pushes.length).toBe(1));
    expect(server.pushes[0]!.payload).toMatchObject({ toAmount: 120000, rateSource: 'manual' });
  });

  it('saving never waits: the last known rate is used at once, and a newer one serves the next operation', async () => {
    await saveRate('USD', 'UZS', 12000, '2026-11-01');
    let answer: (v: number) => void = () => undefined;
    rate.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await openExpense('usd');
    await typeKeys('10');
    await waitFor(() => expect(textOf('amount-to-display')).toBe('120 000 UZS'));

    await save();
    await waitFor(() => expect(server.pushes.length).toBe(1));
    expect(server.pushes[0]!.payload).toMatchObject({ toAmount: 120000, rateSource: 'cbu', rateDate: '2026-11-01' });

    await act(async () => { answer(12500); });
    await waitFor(async () => expect((await loadSavedRate('USD', 'UZS'))?.rate).toBe(12500));
  });

  it('an old date looked up later does not bring an old rate back', async () => {
    await saveRate('USD', 'UZS', 12500, '2026-11-04');
    await saveRate('USD', 'UZS', 11000, '2026-01-10');
    expect(await loadSavedRate('USD', 'UZS')).toEqual({ rate: 12500, day: '2026-11-04' });
  });

  it('no connection and no saved rate: the last rate from history is used without waiting', async () => {
    rate.mockResolvedValue(null);
    server.txs = [{
      id: 't0', type: 2, amount: 1, currency: 'USD', walletId: 'usd', toAmount: 12100, toCurrency: 'UZS', fxRate: 12100,
      categoryId: 'c1', occurredAt: '2026-10-01T10:00:00.000Z', createdAt: '2026-10-01T10:00:00.000Z',
    } as never];
    await openExpense('usd');
    await typeKeys('10');
    await waitFor(() => expect(textOf('amount-to-display')).toBe('121 000 UZS'));
    await save();
    await waitFor(() => expect(server.pushes.length).toBe(1));
    expect(server.pushes[0]!.payload).toMatchObject({ toAmount: 121000, rateSource: 'last_used' });
  });

  it('a wallet in the profile currency stays a plain expense, with no second amount', async () => {
    await openExpense('uzs');
    await typeKeys('5000');
    expect(screen.queryByTestId('amount-to-display')).toBeNull();
    await save();
    await waitFor(() => expect(server.pushes.length).toBe(1));
    expect(server.pushes[0]!.payload).not.toHaveProperty('toCurrency');
    expect(rate).not.toHaveBeenCalled();
  });

  it('history shows the dollars and the converted sum', async () => {
    server.txs = [{
      id: 't1', type: 2, amount: 10, currency: 'USD', walletId: 'usd', toAmount: 119416.5, toCurrency: 'UZS', fxRate: 11941.65,
      categoryId: 'c1', occurredAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    } as never];
    await renderApp(<History />);
    await screen.findByTestId('tx-t1');
    // the row and the day total read in sums; the dollars are only the small line under the row
    expect(screen.getAllByText(/119\s416,50\sUZS/).length).toBe(2);
    expect(textOf('amount-other-t1')).toBe('10 USD');
  });
});
