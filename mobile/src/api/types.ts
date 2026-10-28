// Mirrors backend contracts. Amounts are JSON numbers used for DISPLAY only;
// every money calculation happens in the backend ledger.

export const TxType = {
  Opening: 0, Income: 1, Expense: 2, Transfer: 3, DebtBorrow: 4, DebtLend: 5,
  DebtRepayment: 6, DebtCollection: 7, Adjustment: 8, Reversal: 9,
} as const;
export type TxTypeValue = (typeof TxType)[keyof typeof TxType];

export interface UserProfile { id: string; email: string; displayName: string; locale: string; defaultCurrency: string; theme: string }
export interface AuthResponse { accessToken: string; refreshToken: string; accessExpiresAt: string; user: UserProfile }

export interface Wallet {
  id: string; name: string; type: number; currency: string; balance: number; icon: string; color: string;
  bankName?: string | null; maskedNumber?: string | null; note?: string | null;
  allowOverdraft: boolean; isArchived: boolean; sortOrder: number;
}
export interface Category { id: string; name: string; icon: string; color: string; parentId?: string | null; monthlyLimit?: number | null; limitCurrency?: string | null; isArchived: boolean; sortOrder: number }
export interface IncomeSource { id: string; name: string; icon: string; color: string; isArchived: boolean; sortOrder: number }
export interface Person { id: string; name: string; phone?: string | null; note?: string | null }
export interface Project { id: string; name: string; icon: string; color: string; currency: string; note?: string | null; isArchived: boolean }

export interface Debt {
  id: string; personId: string; direction: number; currency: string; principal: number; outstanding: number;
  dueDate?: string | null; status: number; projectId?: string | null; reason?: string | null; note?: string | null; createdAt: string;
}

export interface Tx {
  id: string; type: TxTypeValue; occurredAt: string; amount: number; currency: string;
  walletId?: string | null; toWalletId?: string | null; toAmount?: number | null; toCurrency?: string | null; fxRate?: number | null;
  categoryId?: string | null; incomeSourceId?: string | null; personId?: string | null; projectId?: string | null; debtId?: string | null;
  reason?: string | null; memo?: string | null; reversalOfId?: string | null; reversedById?: string | null; replacesId?: string | null; createdAt: string;
  rateDate?: string | null; rateSource?: string | null; profileId?: string | null;
}

export interface Snapshot {
  cursor: string; hasMore: boolean; transactions: Tx[]; wallets: Wallet[]; categories: Category[];
  incomeSources: IncomeSource[]; people: Person[]; projects: Project[]; debts: Debt[];
}

export interface CurrencyTotals { currency: string; income: number; expense: number; netFlow: number; borrowed: number; lent: number; debtRepaid: number; debtCollected: number }
export interface DebtPosition { currency: string; iOwe: number; owedToMe: number }
export interface TopExpense { id: string; occurredAt: string; amount: number; currency: string; category?: string | null; memo?: string | null }
export interface Summary { totals: CurrencyTotals[]; debts: DebtPosition[]; topExpenses?: TopExpense[] }
/** Wallet balance history from ledger lines (GET /api/analytics/balance). */
export interface BalancePoint { period: string; start: string; balance: number }
export interface BalanceCurrency { currency: string; opening: number; closing: number; points: BalancePoint[] }
export interface BalanceHistory { granularity: string; from: string; to: string; currencies: BalanceCurrency[] }
export interface WalletPeriod { walletId: string; name: string; currency: string; isArchived: boolean; opening: number; closing: number }
export interface BreakdownRow { id: string | null; name: string; currency: string; total: number; percent: number; count: number }
export interface SeriesPoint { period: string; start: string; currency: string; income: number; expense: number }
export interface BudgetStatus { categoryId: string; name: string; currency: string; limit: number; spent: number; remaining: number; percent: number; exceeded: boolean }

export interface ProjectSummary {
  project: Project;
  income: Record<string, number>; expense: Record<string, number>; remaining: Record<string, number>;
  wallets: { walletId: string; wallet: string; currency: string; allocated: number }[];
}

export interface ClientPolicy { minVersion: string; latestVersion: string; apiVersion: number; message?: string | null }

/** Operation waiting in the offline queue; `clientOperationId` doubles as the server idempotency key. */
export interface PendingOp {
  clientOperationId: string; kind: 'income' | 'expense' | 'transfer' | 'debt' | 'repay' | 'reverse';
  payload: Record<string, unknown>; targetId?: string | null; createdAt: string; error?: string | null;
}

export interface TxFilter {
  q?: string; type?: number; walletId?: string; categoryId?: string; projectId?: string; sourceId?: string;
  personId?: string; currency?: string; minAmount?: number; maxAmount?: number; from?: string; to?: string;
  includeReversed?: boolean;
}
