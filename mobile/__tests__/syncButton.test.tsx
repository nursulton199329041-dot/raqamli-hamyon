import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dashboard } from '@/features/Dashboard';
import { api } from '@/state/runtime';
import { useSettings } from '@/state/settings';
import { FakeServer, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.setTimeout(30000);

let restore: () => void;
let pulls: (() => void)[];
let holdPulls: boolean;

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true, localFirst: false });
  const server = new FakeServer();
  server.wallets = [wallet('w1', 'Karta', 1_000_000)];
  restore = server.install();
  pulls = [];
  holdPulls = false;
  const answer = (api.get as jest.Mock).getMockImplementation()!;
  (api.get as jest.Mock).mockImplementation(async (path: string, q?: unknown) => {
    if (path === '/api/sync/pull' && holdPulls) await new Promise<void>((resolve) => { pulls.push(resolve); });
    return answer(path, q);
  });
});
afterEach(() => restore());

const refresh = () => screen.getByTestId('dash-scroll').props.refreshControl.props as { refreshing: boolean; onRefresh(): void };
const release = async () => { await act(async () => { pulls.splice(0).forEach((r) => r()); }); };

async function home() {
  await renderApp(<Dashboard />);
  await screen.findByText('Karta');
  holdPulls = true;
}

describe('the sync button and pull to refresh', () => {
  it('tapping the button keeps the spinner in the button: the pull-to-refresh spinner does not drop', async () => {
    await home();
    await fireEvent.press(screen.getByTestId('sync-button'));
    await waitFor(() => expect(pulls.length).toBe(1));
    expect(refresh().refreshing).toBe(false);
    await release();
  });

  it('a second tap while it runs does not throw the running request away and start again', async () => {
    await home();
    await fireEvent.press(screen.getByTestId('sync-button'));
    await waitFor(() => expect(pulls.length).toBe(1));
    await fireEvent.press(screen.getByTestId('sync-button'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(pulls.length).toBe(1);
    await release();
  });

  it('a pull while the button runs joins it too', async () => {
    await home();
    await fireEvent.press(screen.getByTestId('sync-button'));
    await waitFor(() => expect(pulls.length).toBe(1));
    await act(async () => { refresh().onRefresh(); await new Promise((r) => setTimeout(r, 50)); });
    expect(pulls.length).toBe(1);
    await release();
    await waitFor(() => expect(refresh().refreshing).toBe(false));
  });

  it('pulling shows its spinner until the data is back, and it never stays stuck', async () => {
    await home();
    await act(async () => { refresh().onRefresh(); });
    await waitFor(() => expect(pulls.length).toBe(1));
    expect(refresh().refreshing).toBe(true);
    await release();
    await waitFor(() => expect(refresh().refreshing).toBe(false));
  });
});
