namespace Hamyon.Domain;

public enum WalletType { Cash = 0, BankCard = 1, BankAccount = 2, Savings = 3, Virtual = 4, Project = 5 }

/// <summary>Role of a ledger account in the double-entry book.</summary>
public enum LedgerAccountKind
{
    Wallet = 0,        // real money container (asset)
    IncomeSource = 1,  // counter-account of income (credit)
    ExpenseCategory = 2,
    Debt = 3,          // one account per Debt (liability or receivable)
    Equity = 4,        // opening balances
    Adjustment = 5,    // manual balance corrections
    FxClearing = 6     // balances each currency leg of a conversion
}

public enum TransactionType
{
    Opening = 0,
    Income = 1,
    Expense = 2,
    Transfer = 3,
    DebtBorrow = 4,     // I borrowed money (wallet up, not income)
    DebtLend = 5,       // I lent money (wallet down, not expense)
    DebtRepayment = 6,  // I repay money I borrowed
    DebtCollection = 7, // somebody repays me
    Adjustment = 8,
    Reversal = 9
}

public enum DebtDirection { Borrowed = 0, Lent = 1 }

public enum DebtStatus { Open = 0, Settled = 1, Cancelled = 2 }
