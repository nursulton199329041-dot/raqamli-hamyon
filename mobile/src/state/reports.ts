import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { BalanceHistory, BreakdownRow, SeriesPoint, Summary, Tx, WalletPeriod } from '@/api/types';
import type { Granularity, Query, ReportFilter } from '@/lib/reportFilter';
import { read } from './reads';

/**
 * The single Reports filter. Charts, statistics, the operations list and the Excel export all read it,
 * so changing a filter updates all of them from the same state.
 */
interface ReportState {
  filter: ReportFilter;
  set(patch: Partial<ReportFilter>): void;
  /** clears wallet / source / category / project, keeps report kind, period and currency */
  clearFilters(): void;
}

export const useReports = create<ReportState>((set) => ({
  filter: { kind: 'expense', preset: 'month', anchor: new Date().toISOString() },
  set: (patch) => set((s) => {
    const next = { ...s.filter, ...patch };
    // a sub-category only makes sense under its parent
    if ('categoryId' in patch && patch.categoryId !== s.filter.categoryId) next.subCategoryId = undefined;
    return { filter: next };
  }),
  clearFilters: () => set((s) => ({
    filter: { ...s.filter, walletId: undefined, sourceId: undefined, categoryId: undefined, subCategoryId: undefined, projectId: undefined },
  })),
}));

const opts = { placeholderData: keepPreviousData, staleTime: 5_000 } as const;

export const useReportSummary = (q: Query, enabled = true) =>
  useQuery({ queryKey: ['report', 'summary', q], queryFn: () => read<Summary>('/api/analytics/summary', q), enabled, ...opts });

export const useReportSeries = (q: Query, granularity: Granularity, enabled = true) =>
  useQuery({
    queryKey: ['report', 'series', q, granularity],
    queryFn: () => read<SeriesPoint[]>('/api/analytics/timeseries', { ...q, granularity }),
    enabled,
    ...opts,
  });

export const useReportBalance = (q: Query, granularity: Granularity, enabled = true) =>
  useQuery({
    queryKey: ['report', 'balance', q, granularity],
    queryFn: () => read<BalanceHistory>('/api/analytics/balance', { ...q, granularity }),
    enabled,
    ...opts,
  });

/** `type`: 1 income, 2 expense. */
export const useReportBreakdown = (q: Query, by: string, type: 1 | 2, enabled = true) =>
  useQuery({
    queryKey: ['report', 'breakdown', q, by, type],
    queryFn: () => read<BreakdownRow[]>('/api/analytics/breakdown', { ...q, by, type }),
    enabled,
    ...opts,
  });

export const useReportWallets = (q: Query, enabled = true) =>
  useQuery({ queryKey: ['report', 'wallets', q], queryFn: () => read<WalletPeriod[]>('/api/analytics/wallets', q), enabled, ...opts });

/** Latest operations matching the same filter (`type` narrows to one transaction type). */
export const useReportTransactions = (q: Query, type?: number) =>
  useQuery({
    queryKey: ['report', 'transactions', q, type],
    queryFn: async () => (await read<{ items: Tx[]; total: number }>('/api/transactions', { ...q, type, pageSize: 30 })),
    ...opts,
  });
