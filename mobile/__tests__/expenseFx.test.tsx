import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { officialRate } from '@/lib/rates';
import { OperationSheet } from '@/features/OperationSheet';
import { History } from '@/features/History';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { category, FakeServer, wallet } from '../test-utils/fakeServer';
import { renderApp, save, textOf, typeKeys } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/lib/rates', () => ({ officialRate: jest.fn() }));
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
    await screen.findByText(/119\s41\d/);
    expect(screen.getAllByText(/10\sUSD/).length).toBeGreaterThan(0);
  });
});
