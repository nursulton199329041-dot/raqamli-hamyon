import { localSnapshot, resetLocalBook, type LocalBook } from '@/local/bridge';
import { LocalLedger } from '@/local/ledger';
import { migrate } from '@/local/migrate';
import { SyncEngine, type RemotePull } from '@/local/sync';
import { createProfile, selectProfile } from '@/state/profiles';
import { currentBook, useQueue } from '@/state/queue';
import { useSession } from '@/state/session';
import { nodeDb } from '../test-utils/nodeDb';

let mockDb: ReturnType<typeof nodeDb>;
jest.mock('@/offline/sqlite', () => ({ openLocalDb: async () => mockDb, openSqliteStorage: async () => { throw new Error('not used'); } }));

const book = async () => (await currentBook())!;

beforeEach(async () => {
  mockDb = nodeDb();
  await migrate(mockDb);
  resetLocalBook();
  useSession.setState({ status: 'guest', user: null });
});

describe('profiles in the device book', () => {
  it('a guest makes a second profile and moves to it: each keeps its own money, and the choice survives a restart', async () => {
    const first = await book();
    await first.ledger.createWallet(first.profileId, { name: 'Birinchi', currency: 'UZS', initialMinor: 100_00 });

    await createProfile('Sultonbek', 'USD');
    const rows = await mockDb.all<{ id: string; name: string; base_currency: string }>('SELECT id, name, base_currency FROM profiles ORDER BY sort_order');
    expect(rows.map((r) => [r.name, r.base_currency])).toEqual([['Asosiy', 'UZS'], ['Sultonbek', 'USD']]);

    await selectProfile(rows[1]!.id);
    const second = await book();
    expect(second.profileId).toBe(rows[1]!.id);
    expect((await localSnapshot(second)).wallets).toEqual([]);

    resetLocalBook(); // the app is opened again
    expect((await book()).profileId).toBe(rows[1]!.id);

    await selectProfile(first.profileId);
    expect((await localSnapshot(await book())).wallets.map((w) => w.name)).toEqual(['Birinchi']);
  });

  it('what was entered in another profile is still sent while this one is on screen', async () => {
    const ledger = new LocalLedger(mockDb);
    await ledger.adoptCloudAccount({ id: 'u1' }, [{ id: 'p1', name: 'A', baseCurrency: 'UZS' }, { id: 'p2', name: 'B', baseCurrency: 'UZS' }]);
    await ledger.createWallet('p2', { name: 'Ikkinchi', currency: 'UZS', initialMinor: 50_00 });
    const pushedFor: string[] = [];
    const engine = new SyncEngine(mockDb, {
      push: async (profileId, ops) => {
        pushedFor.push(profileId);
        return ops.map((o) => ({ clientOperationId: o.clientOperationId, status: 'applied' as const }));
      },
      pull: async () => ({ cursor: 'c', wallets: [], categories: [], incomeSources: [], people: [], debts: [], transactions: [] }) as unknown as RemotePull,
    });
    const b: LocalBook = { db: mockDb, ledger, engine, profileId: 'p1' };
    useSession.setState({ status: 'signedOut', user: null });

    await useQueue.getState().syncLocal(b);

    expect(pushedFor).toEqual(['p2']);
    expect((await mockDb.first<{ n: number }>("SELECT count(*) AS n FROM sync_outbox WHERE status = 'pending'"))?.n).toBe(0);
  });
});
