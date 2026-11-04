import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Settings } from '@/features/Settings';
import { api } from '@/state/runtime';
import { useQueue } from '@/state/queue';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { category, FakeServer, source, wallet } from '../test-utils/fakeServer';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.setTimeout(30000);

const profile = (id: string, name: string, isCurrent = false) => ({
  id, name, color: '#4D8DFF', icon: 'person', baseCurrency: 'UZS', sortOrder: 0, isArchived: false, revision: 1, isCurrent,
});

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  api.setProfileId(null);
  useSettings.setState({ lang: 'uz', reduceEffects: true, localFirst: false });
  useSession.setState({ status: 'signedIn', user: { id: 'u1', email: 'a@b.c', displayName: 'Ali', locale: 'uz', defaultCurrency: 'UZS', theme: 'dark' } });
  server = new FakeServer();
  server.profiles = [profile('p1', 'Shox', true)];
  server.wallets = [wallet('w1', 'Karta', 1_000_000, { allowOverdraft: true }), wallet('w2', 'Eski', 0, { isArchived: true })];
  server.categories = [category('c1', 'Uy'), category('c2', 'Ijara', { parentId: 'c1', monthlyLimit: 500, limitCurrency: 'UZS' })];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
});
afterEach(() => {
  restore();
  api.setProfileId(null);
  useSession.setState({ status: 'signedOut', user: null });
});

async function open() {
  await renderApp(<Settings />);
  await fireEvent.press(await screen.findByTestId('open-wipe'));
  await screen.findByTestId('wipe-sheet');
}

describe('delete profile data', () => {
  it('nothing happens without the second answer; cancel leaves everything', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('wipe-all'));
    await screen.findByTestId('wipe-warning');
    expect(server.profiles).toHaveLength(1);
    await fireEvent.press(screen.getByText('Bekor qilish'));
    await fireEvent.press(screen.getByTestId('wipe-cancel'));
    await waitFor(() => expect(screen.queryByTestId('wipe-sheet')).toBeNull());
    expect(server.profiles).toHaveLength(1);
    expect(server.profiles[0]!.isArchived).toBe(false);
  });

  it('everything: a fresh profile with the default catalog opens under the same name; the old one is only hidden', async () => {
    const post = jest.spyOn(api, 'post');
    await open();
    await fireEvent.press(screen.getByTestId('wipe-all'));
    await fireEvent.press(await screen.findByTestId('wipe-yes'));
    await waitFor(() => expect(server.profiles.find((x) => x.id === 'p1')!.isArchived).toBe(true));

    const fresh = server.profiles.find((x) => x.id !== 'p1')!;
    expect(fresh.name).toBe('Shox');
    expect(api.getProfileId()).toBe(fresh.id);
    expect(post).toHaveBeenCalledWith('/api/profiles', expect.objectContaining({ name: 'Shox', seedDefaults: true }));
    expect(server.profileWrites).toHaveLength(0); // nothing copied
    expect(server.wallets.find((w) => w.id === 'w1')!.balance).toBe(1_000_000); // old records untouched
  });

  it('only operations: wallets at zero, categories under their parents and sources move to the fresh profile', async () => {
    const post = jest.spyOn(api, 'post');
    await open();
    await fireEvent.press(screen.getByTestId('wipe-ops'));
    await fireEvent.press(await screen.findByTestId('wipe-yes'));
    await waitFor(() => expect(server.profiles.find((x) => x.id === 'p1')!.isArchived).toBe(true));

    const fresh = server.profiles.find((x) => x.id !== 'p1')!;
    expect(post).toHaveBeenCalledWith('/api/profiles', expect.objectContaining({ seedDefaults: false }));
    expect(server.profileWrites.every((w) => w.profileId === fresh.id)).toBe(true);
    const wallets = server.profileWrites.filter((w) => w.path === '/api/wallets');
    expect(wallets).toHaveLength(1); // the archived one stays behind
    expect(wallets[0]!.body).toMatchObject({ name: 'Karta', initialBalance: 0, allowOverdraft: true, currency: 'UZS' });
    const cats = server.profileWrites.filter((w) => w.path === '/api/categories');
    expect(cats.map((c) => c.body.name)).toEqual(['Uy', 'Ijara']);
    expect(cats[1]!.body.parentId).toBe(cats[0]!.id); // the new parent, not the old id
    expect(cats[1]!.body).toMatchObject({ monthlyLimit: 500, limitCurrency: 'UZS' });
    expect(server.profileWrites.filter((w) => w.path === '/api/income-sources').map((s) => s.body.name)).toEqual(['Maosh']);
  });

  it('a failed copy changes nothing: the half made profile is hidden, the current one stays and the reason is shown', async () => {
    server.failProfileWrite = '/api/categories';
    await open();
    await fireEvent.press(screen.getByTestId('wipe-ops'));
    await fireEvent.press(await screen.findByTestId('wipe-yes'));
    await screen.findByText(/copy failed/);
    expect(server.profiles.find((x) => x.id === 'p1')!.isArchived).toBe(false);
    expect(server.profiles.find((x) => x.id !== 'p1')!.isArchived).toBe(true);
    expect(api.getProfileId()).toBeNull();
  });

  it('unsent operations are delivered first: they would be left behind', async () => {
    await open();
    useQueue.setState({ pending: [{ clientOperationId: 'o1', kind: 'expense', payload: {}, targetId: null, createdAt: '2026-11-04T00:00:00Z' }] });
    await fireEvent.press(screen.getByTestId('wipe-all'));
    await fireEvent.press(await screen.findByTestId('wipe-yes'));
    await screen.findByText(/yuborilmagan operatsiyalar/);
    expect(server.profiles).toHaveLength(1);
  });
});
