import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Summary, Wallet } from '@/api/types';
import { BalanceSummary, balanceByCurrency } from '@/features/BalanceSummary';

const wallet = (id: string, currency: string, balance: number): Wallet => ({
  id, name: id, type: 0, currency, balance, icon: 'wallet', color: '#4D8DFF', allowOverdraft: false, isArchived: false, sortOrder: 0,
});

const summary: Summary = {
  totals: [{ currency: 'UZS', income: 1_200_000, expense: 450_000, netFlow: 750_000, borrowed: 0, lent: 0, debtRepaid: 0, debtCollected: 0 }],
  debts: [],
};

describe('BalanceSummary', () => {
  it('sums wallet balances per currency', () => {
    expect(balanceByCurrency([wallet('a', 'UZS', 100), wallet('b', 'UZS', 250), wallet('c', 'USD', 7)]))
      .toEqual([{ currency: 'UZS', total: 350 }, { currency: 'USD', total: 7 }]);
  });

  it('shows total balance and the backend period figures (income, expense, signed net change)', async () => {
    const onPeriod = jest.fn();
    await render(<BalanceSummary wallets={[wallet('a', 'UZS', 5_000_000)]} summary={summary} loading={false} periodLabel="01 OKT. – 31 OKT." onPeriod={onPeriod} />);
    expect(screen.getByTestId('summary-balance')).toHaveTextContent('5 000 000 UZS');
    expect(screen.getByTestId('summary-income')).toHaveTextContent('1.2 mln UZS'); // compacted: KPI cells are narrow
    expect(screen.getByTestId('summary-expense')).toHaveTextContent('450 000 UZS');
    expect(screen.getByTestId('summary-net')).toHaveTextContent('+750 000 UZS');
    await fireEvent.press(screen.getByTestId('period-button'));
    expect(onPeriod).toHaveBeenCalledTimes(1);
  });

  it('shows skeletons instead of zeros while the period summary is loading', async () => {
    await render(<BalanceSummary wallets={[]} loading periodLabel="x" onPeriod={() => {}} />);
    expect(screen.queryByTestId('summary-income')).toBeNull();
    expect(screen.queryByTestId('summary-balance')).toBeNull();
  });
});
