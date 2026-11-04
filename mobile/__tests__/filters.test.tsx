import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { History } from '@/features/History';
import { Reports } from '@/features/reports/Reports';
import { api } from '@/state/runtime';
import { useReports } from '@/state/reports';
import { useSettings } from '@/state/settings';
import { category, FakeServer, source, wallet } from '../test-utils/fakeServer';
import { renderApp, textOf } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.setTimeout(30000);

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true, localFirst: false });
  useReports.setState({ filter: { kind: 'expense', preset: 'month', anchor: new Date().toISOString() } });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Karta', 1_000_000), wallet('w2', 'Dollar', 500, { currency: 'USD' })];
  server.categories = [category('c1', 'Kommunal'), category('c2', 'Transport')];
  server.sources = [source('s1', 'Maosh')];
  const at = new Date().toISOString();
  server.txs = [
    { id: 't1', type: 2, amount: 100, currency: 'UZS', walletId: 'w1', categoryId: 'c1', occurredAt: at, createdAt: at },
    { id: 't2', type: 2, amount: 200, currency: 'UZS', walletId: 'w1', categoryId: 'c2', occurredAt: at, createdAt: at },
  ] as never;
  restore = server.install();
});
afterEach(() => restore());

const lastQuery = (path: string) => {
  const calls = (api.get as jest.Mock).mock.calls.filter(([p]) => p === path);
  return (calls[calls.length - 1]?.[1] ?? {}) as Record<string, unknown>;
};

describe('History filter', () => {
  it('shows the blocks with icons; choosing one narrows the list and the totals, and clearing brings all back', async () => {
    await renderApp(<History />);
    await fireEvent.press(await screen.findByTestId('filter-button'));
    await screen.findByTestId('filter-section-category');
    expect(screen.getByTestId('filter-section-wallet')).toBeTruthy();
    expect(screen.getByTestId('filter-section-source')).toBeTruthy();
    expect(screen.queryByTestId('filter-section-project')).toBeNull(); // no projects: no empty block
    expect(textOf('filter-count-category')).toBe('Hammasi');

    await fireEvent.press(screen.getByTestId('filter-category-c1'));
    await waitFor(() => expect(lastQuery('/api/transactions')).toMatchObject({ categoryId: 'c1' }));
    expect(lastQuery('/api/analytics/summary')).toMatchObject({ categoryId: 'c1' });
    expect(textOf('filter-count-category')).toBe('1 / 2');
    await waitFor(() => expect(screen.queryByTestId('tx-t2')).toBeNull());
    expect(screen.getByTestId('tx-t1')).toBeTruthy();
    expect(textOf('filter-button-count')).toBe('1');

    expect(screen.queryByText('Tozalash')).toBeNull(); // no clear word per block: the icon again, or the common one on top
    await fireEvent.press(screen.getByTestId('filter-category-c1'));
    await screen.findByTestId('tx-t2');
    expect(screen.queryByTestId('filter-button-count')).toBeNull();
  });

  it('one choice per block: another icon replaces it, the same icon again removes it, reset clears everything', async () => {
    await renderApp(<History />);
    await fireEvent.press(await screen.findByTestId('filter-button'));
    await fireEvent.press(await screen.findByTestId('filter-wallet-w1'));
    await fireEvent.press(screen.getByTestId('filter-wallet-w2'));
    await waitFor(() => expect(lastQuery('/api/transactions')).toMatchObject({ walletId: 'w2' }));
    await fireEvent.press(screen.getByTestId('filter-wallet-w2'));
    expect(screen.queryByTestId('filter-button-count')).toBeNull();

    await fireEvent.press(screen.getByTestId('filter-source-s1'));
    await fireEvent.press(screen.getByTestId('filter-category-c2'));
    expect(textOf('filter-button-count')).toBe('2');
    await fireEvent.press(screen.getByTestId('reset-filters'));
    expect(screen.queryByTestId('filter-button-count')).toBeNull();
  });
});

describe('filter header', () => {
  it('clear and confirm are icons at the top: nothing to clear dims it, the check closes the sheet', async () => {
    await renderApp(<History />);
    await fireEvent.press(await screen.findByTestId('filter-button'));
    await screen.findByTestId('filter-section-wallet');
    expect(screen.getByLabelText('Filtrlarni tozalash').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Tasdiqlash')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('filter-wallet-w1'));
    expect(screen.getByLabelText('Filtrlarni tozalash').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('close-filters'));
    await waitFor(() => expect(screen.queryByTestId('filter-section-wallet')).toBeNull());
    expect(textOf('filter-button-count')).toBe('1'); // the choice stays
  });
});

describe('Reports filter', () => {
  it('the common clear brings everything back: filters, report type, period and currency', async () => {
    useReports.setState({ filter: { kind: 'compare', preset: 'year', anchor: new Date(2020, 1, 1).toISOString(), walletId: 'w2', currency: 'USD' } });
    await renderApp(<Reports />);
    await fireEvent.press(await screen.findByTestId('open-filters'));
    await fireEvent.press(await screen.findByTestId('reset-filters'));
    expect(useReports.getState().filter).toMatchObject({ kind: 'expense', preset: 'month' });
    expect(useReports.getState().filter.walletId).toBeUndefined();
    expect(useReports.getState().filter.currency).toBeUndefined();
    expect(new Date(useReports.getState().filter.anchor).getFullYear()).toBe(new Date().getFullYear());
    expect(screen.getByLabelText('Filtrlarni tozalash').props.accessibilityState.disabled).toBe(true);
  });

  it('own period: there is no apply button, the check takes the dates; wrong dates keep the sheet open', async () => {
    await renderApp(<Reports />);
    await fireEvent.press(await screen.findByTestId('open-filters'));
    await fireEvent.press(await screen.findByLabelText('Davr'));
    await screen.findByTestId('custom-from');
    expect(screen.queryByTestId('apply-dates')).toBeNull();
    expect(screen.queryByText('Qo‘llash')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('custom-from'), '2026-11-30');
    await fireEvent.changeText(screen.getByTestId('custom-to'), '2026-11-01');
    await fireEvent.press(screen.getByTestId('close-filters'));
    await screen.findByText(/YYYY-MM-DD ko/);
    expect(screen.getByTestId('custom-from')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('custom-from'), '2026-10-01');
    await fireEvent.press(screen.getByTestId('close-filters'));
    await waitFor(() => expect(screen.queryByTestId('custom-from')).toBeNull());
    expect(useReports.getState().filter).toMatchObject({ preset: 'custom', customFrom: '2026-10-01', customTo: '2026-11-01' });
  });

  it('the exit button only leaves: what was chosen stays, typed dates are not taken', async () => {
    useReports.setState({ filter: { kind: 'expense', preset: 'custom', anchor: new Date().toISOString(), customFrom: '2026-11-01', customTo: '2026-11-30' } });
    await renderApp(<Reports />);
    await fireEvent.press(await screen.findByTestId('open-filters'));
    await fireEvent.press(await screen.findByTestId('filter-wallet-w1'));
    await fireEvent.changeText(screen.getByTestId('custom-from'), '2026-10-01');
    await fireEvent.press(screen.getByTestId('filter-close'));
    await waitFor(() => expect(screen.queryByTestId('custom-from')).toBeNull());
    expect(useReports.getState().filter).toMatchObject({ walletId: 'w1', customFrom: '2026-11-01' });
  });

  it('leaving own period for another one hides the dates and the check does not bring them back', async () => {
    await renderApp(<Reports />);
    await fireEvent.press(await screen.findByTestId('open-filters'));
    await fireEvent.press(await screen.findByLabelText('Davr'));
    await screen.findByTestId('custom-from');
    await fireEvent.press(screen.getByLabelText('Yil'));
    expect(screen.queryByTestId('custom-from')).toBeNull();
    await fireEvent.press(screen.getByTestId('close-filters'));
    expect(useReports.getState().filter.preset).toBe('year');
  });

  it('opens from the same round button at the top; a wallet also fixes the currency; reset clears', async () => {
    await renderApp(<Reports />);
    await fireEvent.press(await screen.findByTestId('open-filters'));
    await fireEvent.press(await screen.findByTestId('filter-wallet-w2'));
    expect(useReports.getState().filter).toMatchObject({ walletId: 'w2', currency: 'USD' });
    expect(textOf('open-filters-count')).toBe('1');

    await fireEvent.press(screen.getByTestId('reset-filters'));
    expect(useReports.getState().filter.walletId).toBeUndefined();
    expect(screen.queryByTestId('open-filters-count')).toBeNull();
  });
});
