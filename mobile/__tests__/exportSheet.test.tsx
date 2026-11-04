import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Settings } from '@/features/Settings';
import { exportRange, rangeText } from '@/lib/reportFilter';
import { api } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { category, FakeServer, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class { exists = false; uri = 'file://x'; create() {} write() {} delete() {} },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: async () => undefined }));
jest.setTimeout(30000);

let restore: () => void;
let download: jest.SpyInstance;

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true, localFirst: false });
  useSession.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.c', displayName: 'Ali', locale: 'uz', defaultCurrency: 'UZS', theme: 'dark' } });
  const server = new FakeServer();
  server.wallets = [wallet('w1', 'Karta', 1000)];
  server.categories = [category('c1', 'Kommunal')];
  restore = server.install();
  download = jest.spyOn(api, 'download').mockResolvedValue({ bytes: new ArrayBuffer(4), name: 'RaqamliHamyon_Hisobot.xlsx' });
});
afterEach(() => {
  download.mockRestore();
  restore();
  useSession.setState({ status: 'signedOut', user: null });
});

const sentQuery = () => download.mock.calls[0]![1] as Record<string, unknown>;

async function open() {
  await renderApp(<Settings />);
  await fireEvent.press(await screen.findByTestId('open-export'));
  await screen.findByTestId('export-run');
}

describe('export moved to Settings', () => {
  it('this month is the start: the file covers it, in Excel, and its name is shown', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('export-run'));
    await screen.findByTestId('export-note');
    const now = new Date();
    expect(sentQuery()).toMatchObject({
      format: 'xlsx', lang: 'uz', granularity: 'day',
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString(),
    });
    expect(screen.getByText(/RaqamliHamyon_Hisobot\.xlsx/)).toBeTruthy();
  });

  it('all time sends no dates; type, wallet, category and format are passed on', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('export-period-all'));
    await fireEvent.press(screen.getByTestId('export-type-expense'));
    await fireEvent.press(screen.getByTestId('export-filter'));
    await fireEvent.press(await screen.findByTestId('filter-wallet-w1'));
    await fireEvent.press(screen.getByTestId('filter-category-c1'));
    await fireEvent.press(screen.getByLabelText('CSV'));
    await fireEvent.press(screen.getByTestId('export-run'));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(sentQuery()).toMatchObject({ format: 'csv', type: 2, walletId: 'w1', categoryId: 'c1', granularity: 'month' });
    expect(sentQuery().from).toBeUndefined();
    expect(sentQuery().to).toBeUndefined();
  });

  it('a wrong custom period is refused before anything is asked', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('export-period-custom'));
    await fireEvent.changeText(await screen.findByTestId('export-from'), '2026-13-40');
    await fireEvent.changeText(screen.getByTestId('export-to'), '2026-11-30');
    await fireEvent.press(screen.getByTestId('export-run'));
    await screen.findByText(/Sana/);
    expect(download).not.toHaveBeenCalled();
  });

  it('a guest has no server to make the file, so there is no export row', async () => {
    useSession.setState({ status: 'guest', user: null });
    await renderApp(<Settings />);
    expect(screen.queryByTestId('open-export')).toBeNull();
  });
});

describe('export periods', () => {
  const now = new Date(2026, 10, 4, 12);
  it('months and years end on their last day, whatever month it is now', () => {
    expect(rangeText(exportRange('month', now)!)).toBe('01.11.2026 — 30.11.2026');
    expect(rangeText(exportRange('lastMonth', now)!)).toBe('01.10.2026 — 31.10.2026');
    expect(rangeText(exportRange('year', now)!)).toBe('01.01.2026 — 31.12.2026');
    expect(rangeText(exportRange('lastYear', now)!)).toBe('01.01.2025 — 31.12.2025');
    expect(rangeText(exportRange('lastMonth', new Date(2026, 0, 15))!)).toBe('01.12.2025 — 31.12.2025');
  });

  it('a custom period must be real dates in order; a long one is grouped by month', () => {
    expect(exportRange('custom', now, '2026-11-30', '2026-11-01')).toBeNull();
    expect(exportRange('custom', now, 'x', '2026-11-01')).toBeNull();
    expect(exportRange('custom', now, '2026-11-01', '2026-11-30')?.granularity).toBe('day');
    expect(exportRange('custom', now, '2026-01-01', '2026-11-30')?.granularity).toBe('month');
  });
});
