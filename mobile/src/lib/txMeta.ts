import { TxType, type TxTypeValue } from '@/api/types';
import { Ink } from '@/design/theme';
import type { I18nKey } from '@/i18n';

/** Translation key of each operation type (history list, report list, details). */
export const TX_TYPE_LABEL: Record<TxTypeValue, I18nKey> = {
  [TxType.Opening]: 'initial_balance', [TxType.Income]: 'income', [TxType.Expense]: 'expense', [TxType.Transfer]: 'transfer',
  [TxType.DebtBorrow]: 'borrowed', [TxType.DebtLend]: 'lent', [TxType.DebtRepayment]: 'repay', [TxType.DebtCollection]: 'repay',
  [TxType.Adjustment]: 'adjust', [TxType.Reversal]: 'reversed',
};

/** +1 inflow, -1 outflow, 0 neutral (transfers move money between own wallets). */
export function flowSign(ty: TxTypeValue): number {
  switch (ty) {
    case TxType.Income: case TxType.DebtBorrow: case TxType.DebtCollection: case TxType.Opening: return 1;
    case TxType.Expense: case TxType.DebtLend: case TxType.DebtRepayment: return -1;
    default: return 0;
  }
}

export function txColor(t: TxTypeValue): string {
  switch (t) {
    case TxType.Income: case TxType.Opening: case TxType.Adjustment: return Ink.income;
    case TxType.Expense: return Ink.expense;
    case TxType.Transfer: return Ink.transfer;
    case TxType.Reversal: return '#94A3B8';
    default: return Ink.debt;
  }
}
