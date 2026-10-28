import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Auth } from '@/features/Auth';
import { Settings } from '@/features/Settings';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
// the phone's key-value store, in memory (no native SQLite in Jest); anything else it is asked returns nothing
jest.mock('@/offline/storage', () => {
  const kv = new Map<string, string>();
  const store = new Proxy({
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string) => void kv.set(k, v),
  } as Record<string, unknown>, { get: (t, k: string) => (k === 'then' ? undefined : t[k] ?? (async () => [])) }); // not a thenable
  return { getStorage: async () => store };
});
jest.setTimeout(30000);

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useSession.setState({ status: 'signedOut', user: null, linking: false });
});

describe('local account (guest) on the screens', () => {
  it('the sign-in screen offers to start without an account; it needs no server', async () => {
    await renderApp(<Auth />);
    expect(screen.getByText('Lokal hisob bilan boshlash')).toBeTruthy();
    fireEvent.press(screen.getByTestId('guest-start'));
    await waitFor(() => expect(useSession.getState().status).toBe('guest'));
  });

  it('a guest sees "link an account" instead of sign-out / delete; linking shows what will happen to the data', async () => {
    useSession.setState({ status: 'guest' });
    await renderApp(<Settings />);
    expect(screen.getByText('Lokal hisob')).toBeTruthy();
    expect(screen.queryByText('Chiqish')).toBeNull();
    fireEvent.press(screen.getByTestId('link-account'));
    expect(useSession.getState().linking).toBe(true);

    screen.unmount();
    await renderApp(<Auth />);
    expect(screen.getByTestId('link-notice')).toBeTruthy();
    expect(screen.queryByTestId('guest-start')).toBeNull();
    fireEvent.press(screen.getByTestId('link-back'));
    expect(useSession.getState()).toMatchObject({ linking: false, status: 'guest' });
  });
});
