using System;

namespace Hamyon.App.Models;

public enum OpKind { Income = 1, Expense = 2, Transfer = 3 }

/// <summary>A place money is kept (cash, card, savings). Balance = opening balance + all operations, per its own currency.</summary>
public sealed record Wallet(long Id, string Name, string Icon, string Color, string Currency, decimal Balance);

public sealed record IncomeSource(long Id, string Name, string Icon, string Color);

public sealed record Category(long Id, string Name, string Icon, string Color);

/// <summary>
/// One money movement. Amounts are stored as integer minor units (tiyin / cent) so no floating point ever touches money.
/// Income: SourceId -> WalletId. Expense: WalletId -> CategoryId. Transfer: WalletId -> ToWalletId (ToAmount in the target currency).
/// </summary>
public sealed record Operation(
    long Id, OpKind Kind, decimal Amount, string Currency,
    long? WalletId, long? ToWalletId, decimal? ToAmount,
    long? SourceId, long? CategoryId, DateTime Date, string? Note);

/// <summary>History list row: the operation plus display names of its wallet(s), source and category.</summary>
public sealed record OperationRow(
    long Id, OpKind Kind, decimal Amount, string Currency, decimal? ToAmount, DateTime Date, string? Note,
    string? WalletName, string? ToWalletName, string? ToCurrency,
    string? SourceName, string? SourceIcon, string? SourceColor,
    string? CategoryName, string? CategoryIcon, string? CategoryColor);
