import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { parseBalance } from '@/features/BalanceSheet';
import { Dashboard } from '@/features/Dashboard';
import { Settings } from '@/features/Settings';
import { api } from '@/state/runtime';
import { useQueue } from '@/state/queue';
import { useSession } from '@/state/session';
import { DEFAULT_APPEARANCE, sanitizeAppearance, useSettings } from '@/state/settings';
import { FakeServer, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

const mockPush = jest.fn();
jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.setTimeout(30000);

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  mockPush.mockClear();
  useSettings.setState({ lang: 'uz', reduceEffects: true, localFirst: false, appearance: DEFAULT_APPEARANCE });
  useSession.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.c', displayName: 'Ali', locale: 'uz', defaultCurrency: 'UZS', theme: 'dark' } });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Karta', 1000), wallet('w2', 'Naqd', 500)];
  restore = server.install();
});
afterEach(() => {
  restore();
  useSession.setState({ status: 'signedOut', user: null });
});

describe('debts switch', () => {
  it('on by default: the debts icon stands among the wallets and opens the debts', async () => {
    await renderApp(<Dashboard />);
    await fireEvent.press(await screen.findByTestId('debts-tile'));
    expect(mockPush).toHaveBeenCalledWith('/debts');
  });

  it('Settings has a real on/off switch for it', async () => {
    await renderApp(<Settings />);
    const sw = screen.getByLabelText('Qarzlar');
    expect(useSettings.getState().appearance.showDebts).toBe(true);
    await fireEvent(sw, 'valueChange', false);
    expect(useSettings.getState().appearance.showDebts).toBe(false);
  });

  it('switched off, the home screen has no debts icon', async () => {
    useSettings.setState({ appearance: { ...DEFAULT_APPEARANCE, showDebts: false } });
    await renderApp(<Dashboard />);
    await screen.findByText('Karta');
    expect(screen.queryByTestId('debts-tile')).toBeNull();
  });

  it('an old saved appearance without the switch means on', () => {
    expect(sanitizeAppearance({}).showDebts).toBe(true);
    expect(sanitizeAppearance({ showDebts: false }).showDebts).toBe(false);
  });
});

describe('settings sections', () => {
  it('Panel opens the home sections, the theme page holds the look', async () => {
    await renderApp(<Settings />);
    await fireEvent.press(screen.getByTestId('open-panel'));
    await screen.findByTestId('section-order');
    expect(screen.queryByTestId('appearance-preview')).toBeNull();
    await fireEvent.press(screen.getByTestId('page-close'));
    await fireEvent.press(await screen.findByTestId('open-appearance'));
    await screen.findByTestId('appearance-preview');
    expect(screen.queryByTestId('section-order')).toBeNull();
  });
});

describe('update wallet balances', () => {
  async function open() {
    await renderApp(<Settings />);
    await fireEvent.press(screen.getByTestId('open-balance'));
    await screen.findByTestId('balance-sheet');
    await screen.findByTestId('balance-w1');
  }

  it('only the changed wallet is corrected, on the server as a correction entry', async () => {
    const post = jest.spyOn(api, 'post');
    await open();
    await fireEvent.changeText(screen.getByTestId('balance-w1'), '1 250,50');
    await fireEvent.changeText(screen.getByTestId('balance-w2'), '500');
    await fireEvent.press(screen.getByTestId('balance-save'));
    await waitFor(() => expect(screen.queryByTestId('balance-sheet')).toBeNull());
    const calls = post.mock.calls.filter(([p]) => String(p).includes('/adjust'));
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/api/wallets/w1/adjust');
    expect(calls[0]![1]).toMatchObject({ newBalance: 1250.5 });
    expect(server.wallets.find((w) => w.id === 'w1')!.balance).toBe(1250.5);
  });

  it('a wrong number stops everything; nothing typed just closes', async () => {
    const post = jest.spyOn(api, 'post');
    await open();
    await fireEvent.changeText(screen.getByTestId('balance-w1'), 'abc');
    await fireEvent.press(screen.getByTestId('balance-save'));
    await screen.findByText(/Karta:/);
    expect(post.mock.calls.filter(([p]) => String(p).includes('/adjust'))).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('balance-w1'), '');
    await fireEvent.press(screen.getByTestId('balance-save'));
    await waitFor(() => expect(screen.queryByTestId('balance-sheet')).toBeNull());
  });

  it('unsent operations first: they would move the balance again after it is set', async () => {
    await open();
    useQueue.setState({ pending: [{ clientOperationId: 'o1', kind: 'expense', payload: {}, targetId: null, createdAt: '2026-11-04T00:00:00Z' }] });
    await fireEvent.changeText(screen.getByTestId('balance-w1'), '10');
    await fireEvent.press(screen.getByTestId('balance-save'));
    await screen.findByText(/yuborilmagan/i);
    expect(server.wallets.find((w) => w.id === 'w1')!.balance).toBe(1000);
  });

  it('reads numbers as people type them', () => {
    expect(parseBalance('1 000,5')).toBe(1000.5);
    expect(parseBalance('-20')).toBe(-20);
    expect(parseBalance('1.2.3')).toBeNull();
    expect(parseBalance('')).toBeNull();
  });
});

describe('guest', () => {
  it('has no server to book a correction, so no balance row', async () => {
    useSession.setState({ status: 'guest', user: null });
    await renderApp(<Settings />);
    expect(screen.queryByTestId('open-balance')).toBeNull();
    expect(screen.getByTestId('open-panel')).toBeTruthy();
  });
});
