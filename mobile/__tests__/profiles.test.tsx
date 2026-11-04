import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiClient } from '@/api/client';
import { Dashboard } from '@/features/Dashboard';
import { useQueue } from '@/state/queue';
import { api, queryClient } from '@/state/runtime';
import { useSession } from '@/state/session';
import { DEFAULT_APPEARANCE, useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

const mockPush = jest.fn();
jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.setTimeout(30000);

const profile = (id: string, name: string, isCurrent = false) => ({
  id, name, color: '#4D8DFF', icon: 'person', baseCurrency: 'UZS', sortOrder: 0, isArchived: false, revision: 1, isCurrent,
});

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  mockPush.mockClear();
  queryClient.clear();
  api.setProfileId(null);
  useSettings.setState({ lang: 'uz', reduceEffects: true, appearance: DEFAULT_APPEARANCE, localFirst: false });
  useSession.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.c', displayName: 'Ali', locale: 'uz', defaultCurrency: 'UZS', theme: 'dark' } });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  useQueue.setState({ pending: [], online: true, syncing: false });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Karta', 1_000_000)];
  restore = server.install();
});
afterEach(() => {
  restore();
  api.setProfileId(null);
});

async function openSheet() {
  await renderApp(<Dashboard />);
  await screen.findByText('Karta');
  await fireEvent.press(screen.getByTestId('profile-button'));
  await screen.findByTestId('profiles-sheet');
}

describe('home avatar opens the profiles, not the settings', () => {
  it('several profiles: the list, the current one marked by its initial on the avatar; settings stay behind the gear', async () => {
    server.profiles = [profile('p1', 'Raqamli nazorat', true), profile('p2', 'Sultonbek')];
    await openSheet();
    expect(mockPush).not.toHaveBeenCalled();
    await screen.findByText('Raqamli nazorat');
    expect(screen.getByText('Sultonbek')).toBeTruthy();
    expect(screen.queryByTestId('profile-form')).toBeNull();
    expect(screen.getByText('R')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('profiles-settings'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('only the automatic first profile: the new-profile form opens; the new profile then appears in the list', async () => {
    server.profiles = [profile('p1', 'Asosiy', true)];
    await openSheet();
    await screen.findByTestId('profile-form');

    await fireEvent.changeText(screen.getByLabelText('Ism'), '  Sultonbek ');
    await fireEvent.press(screen.getByText('Saqlash'));

    await screen.findByTestId('profiles-add');
    expect(server.profiles.map((x) => x.name)).toEqual(['Asosiy', 'Sultonbek']);
    expect(screen.getByText('Sultonbek')).toBeTruthy();
    expect(screen.queryByTestId('profile-form')).toBeNull();
  });

  it('with several profiles the add button is there; it opens the form, and the form leads back to the list', async () => {
    server.profiles = [profile('p1', 'Asosiy', true), profile('p2', 'Sultonbek')];
    await openSheet();
    await screen.findByText('Sultonbek');
    await fireEvent.press(screen.getByTestId('profiles-add'));
    await screen.findByTestId('profile-form');
    expect(screen.queryByTestId('profiles-add')).toBeNull();
    await fireEvent.press(screen.getByTestId('profiles-show-list'));
    await screen.findByTestId('profiles-add');
  });

  it('the add button works even when the list could not be loaded', async () => {
    server.profiles = null as never; // the list request fails
    await openSheet();
    await fireEvent.press(screen.getByTestId('profiles-add'));
    await screen.findByTestId('profile-form');
  });

  it('picking a profile: later requests carry it and the screens load again', async () => {
    server.profiles = [profile('p1', 'Asosiy', true), profile('p2', 'Sultonbek')];
    await openSheet();
    await screen.findByText('Sultonbek');
    const seen = server.profileHeaders.length;

    await fireEvent.press(screen.getByTestId('profile-p2'));

    await waitFor(() => expect(screen.queryByTestId('profiles-sheet')).toBeNull());
    expect(api.getProfileId()).toBe('p2');
    await waitFor(() => expect(server.profileHeaders.slice(seen)).toContain('p2'));
  });

  it('unsent operations of a server-only device block the switch: they would land in the other profile', async () => {
    server.profiles = [profile('p1', 'Asosiy', true), profile('p2', 'Sultonbek')];
    await openSheet();
    await screen.findByText('Sultonbek');
    useQueue.setState({ pending: [{ clientOperationId: 'o1', kind: 'expense', payload: {}, targetId: null, createdAt: '2026-11-04T00:00:00Z' }] });

    await fireEvent.press(screen.getByTestId('profile-p2'));

    await screen.findByText(/yuborilmagan operatsiyalar/);
    expect(api.getProfileId()).toBeNull();
    expect(screen.getByTestId('profiles-sheet')).toBeTruthy();
  });
});

describe('api client: the chosen profile', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('goes with every request; a transport naming its own profile wins', async () => {
    const f = jest.fn(async () => json(200, {}));
    global.fetch = f as unknown as typeof fetch;
    const c = new ApiClient('http://x');
    c.setProfileId('p2');
    await c.get('/a');
    await c.request('GET', '/b', { headers: { 'X-Profile-Id': 'p9' } });
    const header = (i: number) => ((f.mock.calls as unknown as [string, { headers: Record<string, string> }][])[i]![1].headers['X-Profile-Id']);
    expect(header(0)).toBe('p2');
    expect(header(1)).toBe('p9');
  });

  it('a remembered profile that is gone is forgotten and the request is asked again', async () => {
    const f = jest.fn(async (_u: string, init: { headers: Record<string, string> }) =>
      (init.headers['X-Profile-Id'] ? json(404, { code: 'profile.not_found', message: 'x' }) : json(200, { ok: true })));
    global.fetch = f as unknown as typeof fetch;
    const c = new ApiClient('http://x');
    const gone = jest.fn();
    c.onProfileGone = gone;
    c.setProfileId('old');
    await expect(c.get('/a')).resolves.toEqual({ ok: true });
    expect(c.getProfileId()).toBeNull();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('any other 404 stays an error and keeps the profile', async () => {
    global.fetch = jest.fn(async () => json(404, { code: 'wallet.not_found', message: 'x' })) as unknown as typeof fetch;
    const c = new ApiClient('http://x');
    c.setProfileId('p1');
    await expect(c.get('/a')).rejects.toMatchObject({ status: 404 });
    expect(c.getProfileId()).toBe('p1');
  });
});
