import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '@/api/client';
import type {
  BreakdownRow, BudgetStatus, Category, IncomeSource, Person, Project, SeriesPoint, Snapshot, Summary, Tx, TxFilter, Wallet,
} from '@/api/types';
import { getStorage } from '@/offline/storage';
import { api } from './runtime';
import { useQueue } from './queue';

export type Period = 'week' | 'month' | 'year' | 'all';

export function periodFrom(p: Period): string | undefined {
  const n = new Date();
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString();
  switch (p) {
    case 'month': return utc(n.getUTCFullYear(), n.getUTCMonth(), 1);
    case 'year': return utc(n.getUTCFullYear(), 0, 1);
    case 'week': {
      const dow = (n.getUTCDay() + 6) % 7;
      return utc(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - dow);
    }
    default: return undefined;
  }
}

async function loadSnapshot(): Promise<Snapshot> {
  const store = await getStorage();
  try {
    await useQueue.getState().flush();
    const snap = await api.get<Snapshot>('/api/sync/pull');
    await store.set('snapshot', JSON.stringify(snap));
    useQueue.getState().setOnline(true);
    return snap;
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) {
      useQueue.getState().setOnline(false);
      const cached = await store.get('snapshot');
      if (cached) return JSON.parse(cached) as Snapshot;
    }
    throw e;
  }
}

export function useSnapshot() {
  return useQuery({ queryKey: ['snapshot'], queryFn: loadSnapshot, staleTime: 10_000 });
}

export interface Catalog {
  loaded: boolean;
  wallets: Wallet[];
  activeWallets: Wallet[];
  categories: Category[];
  sources: IncomeSource[];
  people: Person[];
  projects: Project[];
  transactions: Tx[];
  debts: Snapshot['debts'];
  wallet(id?: string | null): Wallet | undefined;
  category(id?: string | null): Category | undefined;
  source(id?: string | null): IncomeSource | undefined;
  person(id?: string | null): Person | undefined;
  project(id?: string | null): Project | undefined;
}

export function useCatalog(): Catalog {
  const { data } = useSnapshot();
  return useMemo(() => {
    const wallets = data?.wallets ?? [];
    const categories = (data?.categories ?? []).filter((c) => !c.isArchived);
    const sources = (data?.incomeSources ?? []).filter((c) => !c.isArchived);
    const people = data?.people ?? [];
    const projects = (data?.projects ?? []).filter((c) => !c.isArchived);
    const transactions = [...(data?.transactions ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return {
      loaded: !!data, wallets, activeWallets: wallets.filter((w) => !w.isArchived), categories, sources, people, projects,
      transactions, debts: data?.debts ?? [],
      wallet: (id) => wallets.find((w) => w.id === id),
      category: (id) => categories.find((c) => c.id === id),
      source: (id) => sources.find((c) => c.id === id),
      person: (id) => people.find((c) => c.id === id),
      project: (id) => projects.find((c) => c.id === id),
    };
  }, [data]);
}

export function useSummary(period: Period) {
  const from = periodFrom(period);
  return useQuery({
    queryKey: ['summary', period],
    queryFn: () => api.get<Summary>('/api/analytics/summary', { from }),
  });
}

export function useBudgets() {
  return useQuery({ queryKey: ['budgets'], queryFn: () => api.get<BudgetStatus[]>('/api/analytics/budgets') });
}

export function useBreakdown(by: string, period: Period) {
  const from = periodFrom(period);
  return useQuery({
    queryKey: ['breakdown', by, period],
    queryFn: () => api.get<BreakdownRow[]>('/api/analytics/breakdown', { by, from }),
  });
}

export function useSeries(granularity: string, period: Period) {
  const from = periodFrom(period);
  return useQuery({
    queryKey: ['series', granularity, period],
    queryFn: () => api.get<SeriesPoint[]>('/api/analytics/timeseries', { granularity, from }),
  });
}

interface Paged<T> { items: T[]; total: number }

export function useTransactions(filter: TxFilter) {
  return useQuery({
    queryKey: ['transactions', filter],
    queryFn: async () => {
      try {
        const r = await api.get<Paged<Tx>>('/api/transactions', {
          ...filter, includeReversed: true, pageSize: 100,
        } as Record<string, string | number | boolean | undefined>);
        return r.items;
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) {
          // Offline: filter the cached snapshot (display fallback only).
          const cached = await (await getStorage()).get('snapshot');
          const all = cached ? (JSON.parse(cached) as Snapshot).transactions : [];
          const q = filter.q?.toLowerCase();
          return all
            .filter((t) => (filter.type === undefined || t.type === filter.type) && (!filter.walletId || t.walletId === filter.walletId)
              && (!q || (t.memo ?? '').toLowerCase().includes(q)))
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
        }
        throw e;
      }
    },
  });
}
