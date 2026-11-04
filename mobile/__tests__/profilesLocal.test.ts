import { localSnapshot, resetLocalBook, type LocalBook } from '@/local/bridge';
import { LocalLedger } from '@/local/ledger';
import { migrate } from '@/local/migrate';
import { SyncEngine, type RemotePull } from '@/local/sync';
import { createProfile, removeProfile, renameProfile, selectProfile, startOver } from '@/state/profiles';
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

  it('a guest renames and deletes on the device: the money stays in the book, and the last profile cannot go', async () => {
    const first = await book();
    await first.ledger.createWallet(first.profileId, { name: 'Birinchi', currency: 'UZS', initialMinor: 100_00 });
    await createProfile('Ikkinchi', 'UZS');
    const second = (await mockDb.all<{ id: string }>('SELECT id FROM profiles ORDER BY sort_order'))[1]!.id;

    await renameProfile(second, 'Shox');
    expect((await mockDb.first<{ name: string }>('SELECT name FROM profiles WHERE id = ?', second))?.name).toBe('Shox');

    await removeProfile(first.profileId); // the one on screen: the other opens first
    expect((await book()).profileId).toBe(second);
    expect((await mockDb.first<{ n: number }>('SELECT count(*) AS n FROM wallets WHERE profile_id = ?', first.profileId))?.n).toBe(1);
    expect((await mockDb.first<{ a: number }>('SELECT is_archived AS a FROM profiles WHERE id = ?', first.profileId))?.a).toBe(1);

    await expect(removeProfile(second)).rejects.toMatchObject({ code: 'profile.last_active' });
  });

  it('a guest deletes only the operations: same wallets at zero and same catalog in a fresh profile, old rows kept', async () => {
    const first = await book();
    const w = await first.ledger.createWallet(first.profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 500_00 });
    const cat = await first.ledger.createCategory(first.profileId, { name: 'Kafe' });
    await first.ledger.createCategory(first.profileId, { name: 'Choy', parentId: cat });
    await first.ledger.expense(first.profileId, { walletId: w.id, amountMinor: 100_00, categoryId: cat });

    await startOver('operations');

    const fresh = await book();
    expect(fresh.profileId).not.toBe(first.profileId);
    const snap = await localSnapshot(fresh);
    expect(snap.wallets.map((x) => [x.name, x.balance])).toEqual([['Naqd', 0]]);
    expect(snap.transactions).toEqual([]);
    const kafe = snap.categories.find((c) => c.name === 'Kafe')!;
    expect(snap.categories.find((c) => c.name === 'Choy')!.parentId).toBe(kafe.id);
    expect(snap.categories.filter((c) => c.name === 'Kafe')).toHaveLength(1); // not doubled by the default catalog

    expect((await mockDb.first<{ a: number }>('SELECT is_archived AS a FROM profiles WHERE id = ?', first.profileId))?.a).toBe(1);
    expect((await mockDb.first<{ n: number }>('SELECT count(*) AS n FROM transactions WHERE profile_id = ?', first.profileId))?.n).toBeGreaterThan(0);
  });

  it('a guest deletes everything: the fresh profile has only the default catalog', async () => {
    const first = await book();
    await first.ledger.createWallet(first.profileId, { name: 'Naqd', currency: 'UZS', initialMinor: 500_00 });
    await startOver('all');
    const snap = await localSnapshot(await book());
    expect(snap.wallets).toEqual([]);
    expect(snap.categories.length).toBeGreaterThan(0);
    expect((await mockDb.first<{ n: number }>('SELECT count(*) AS n FROM wallets WHERE profile_id = ?', first.profileId))?.n).toBe(1);
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
