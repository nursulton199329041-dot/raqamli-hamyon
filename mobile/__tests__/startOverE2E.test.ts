/**
 * "Delete data" against the REAL backend. Runs only when E2E_API points at a disposable API instance, e.g.
 *   E2E_API=http://127.0.0.1:5083 npx jest __tests__/startOverE2E.test.ts
 */
import type { AuthResponse, Snapshot } from '@/api/types';
import { selectProfile, startOver } from '@/state/profiles';
import { api, queryClient } from '@/state/runtime';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { nodeFetch } from '../test-utils/nodeFetch';

jest.mock('@/offline/storage', () => {
  const kv = new Map<string, string>();
  const store = {
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string) => void kv.set(k, v),
    remove: async (k: string) => void kv.delete(k),
    list: async () => [],
    replaceAll: async () => undefined,
    logUpdate: async () => undefined,
    updateLog: async () => [],
    clearUserData: async () => undefined,
  };
  return { getStorage: async () => store };
});

const BASE = process.env.E2E_API;
const run = BASE ? describe : describe.skip;
if (BASE) globalThis.fetch = nodeFetch as unknown as typeof fetch;
jest.setTimeout(60000);

interface P { id: string; name: string; isArchived: boolean; isCurrent: boolean }

run('delete profile data on the real server', () => {
  let walletId = '';
  let parentId = '';

  beforeAll(async () => {
    api.baseUrl = BASE!;
    useSettings.setState({ localFirst: false });
    const res = await api.post<AuthResponse>('/api/auth/register', {
      email: `wipe-${Date.now()}@e2e.test`, password: 'E2e-pass-1234', displayName: 'E2E', locale: 'uz',
    });
    api.setTokens({ access: res.accessToken, refresh: res.refreshToken });
    useSession.setState({ status: 'signedIn', user: res.user });
    walletId = (await api.post<{ id: string }>('/api/wallets', {
      name: 'Asosiy karta', type: 1, currency: 'UZS', initialBalance: 500_000, icon: 'card', color: '#2563EB', allowOverdraft: true,
    })).id;
    parentId = (await api.post<{ id: string }>('/api/categories', { name: 'Maxsus', icon: 'home', color: '#EA580C', monthlyLimit: 900_000, limitCurrency: 'UZS' })).id;
    await api.post('/api/categories', { name: 'Ichki', icon: 'home', color: '#EA580C', parentId });
    await api.post('/api/projects', { name: 'Loyiha A', icon: 'project', color: '#7C3AED', currency: 'UZS' });
    await api.post('/api/people', { name: 'Vali' });
    await api.post('/api/sync/push', { operations: [{
      clientOperationId: `op-${Date.now()}`, kind: 'expense', targetId: null,
      payload: { walletId, amount: 100_000, categoryId: parentId, occurredAt: new Date().toISOString() },
    }] });
  });

  afterAll(() => queryClient.clear());

  it('only operations: a fresh profile with the same catalog, zero balances and no history; the old one hidden, intact', async () => {
    const before = await api.get<Snapshot>('/api/sync/pull');
    expect(before.wallets.find((w) => w.id === walletId)!.balance).toBe(400_000);
    const oldProfile = (await api.get<P[]>('/api/profiles')).find((p) => p.isCurrent)!;

    await startOver('operations');

    const list = await api.get<P[]>('/api/profiles');
    expect(list.find((p) => p.id === oldProfile.id)!.isArchived).toBe(true);
    const current = list.find((p) => p.isCurrent)!;
    expect(current.id).not.toBe(oldProfile.id);
    expect(current.name).toBe(oldProfile.name);

    const now = await api.get<Snapshot>('/api/sync/pull');
    expect(now.transactions).toEqual([]);
    expect(now.debts).toEqual([]);
    expect(now.wallets.map((w) => [w.name, w.balance, w.allowOverdraft])).toContainEqual(['Asosiy karta', 0, true]);
    const parent = now.categories.find((c) => c.name === 'Maxsus')!;
    expect(parent.monthlyLimit).toBe(900_000);
    expect(now.categories.find((c) => c.name === 'Ichki')!.parentId).toBe(parent.id);
    expect(now.categories.filter((c) => c.name === 'Maxsus')).toHaveLength(1);
    expect(now.projects!.map((p) => p.name)).toContain('Loyiha A');
    expect(now.people.map((p) => p.name)).toContain('Vali');

    // the old profile no longer opens in normal use; it is archived, not erased

    const hidden = await api.request<Snapshot>('GET', '/api/sync/pull', { headers: { 'X-Profile-Id': oldProfile.id } }).catch((e: { code?: string }) => e);
    expect(hidden).toMatchObject({ code: 'profile.not_found' });
  });

  it('everything: the fresh profile holds only the default catalog', async () => {
    const before = (await api.get<P[]>('/api/profiles')).find((p) => p.isCurrent)!;
    await startOver('all');
    const list = await api.get<P[]>('/api/profiles');
    expect(list.find((p) => p.id === before.id)!.isArchived).toBe(true);
    const now = await api.get<Snapshot>('/api/sync/pull');
    expect(now.transactions).toEqual([]);
    expect(now.wallets.some((w) => w.name === 'Asosiy karta')).toBe(false);
    expect(now.categories.some((c) => c.name === 'Maxsus')).toBe(false);
    expect(now.categories.length).toBeGreaterThan(0);
  });

  it('after a restart with the remembered profile, nothing old comes back', async () => {
    const current = (await api.get<P[]>('/api/profiles')).find((p) => p.isCurrent)!;
    await selectProfile(current.id);
    const now = await api.get<Snapshot>('/api/sync/pull');
    expect(now.wallets.some((w) => w.name === 'Asosiy karta')).toBe(false);
  });
});
