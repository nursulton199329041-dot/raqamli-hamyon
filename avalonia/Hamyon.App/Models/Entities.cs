using System;

namespace Hamyon.App.Models;

/// <summary>Lend: money leaves the wallet, the person owes me. Borrow: money comes into the wallet (a loan, or a lent sum returned).</summary>
public enum OpKind { Income = 1, Expense = 2, Transfer = 3, Lend = 4, Borrow = 5 }

/// <summary>A place money is kept (cash, card, savings). Balance = opening balance + all operations, per its own currency.</summary>
public sealed record Wallet(long Id, string Name, string Icon, string Color, string Currency, decimal Balance);

public sealed record IncomeSource(long Id, string Name, string Icon, string Color);

public sealed record Category(long Id, string Name, string Icon, string Color);

/// <summary>
/// One money movement. Amounts are stored as integer minor units (tiyin / cent) so no floating point ever touches money.
/// Income: SourceId -> WalletId. Expense: WalletId -> CategoryId. Transfer: WalletId -> ToWalletId (ToAmount in the target currency).
/// Lend / Borrow: WalletId and Person. Income / expense in a wallet that is not in so'm also keep BaseAmount (UZS) and Rate.
/// </summary>
public sealed record Operation(
    long Id, OpKind Kind, decimal Amount, string Currency,
    long? WalletId, long? ToWalletId, decimal? ToAmount,
    long? SourceId, long? CategoryId, DateTime Date, string? Note, string? Person = null,
    decimal? BaseAmount = null, decimal? Rate = null);

/// <summary>History list row: the operation plus display names of its wallet(s), source and category.</summary>
public sealed record OperationRow(
    long Id, OpKind Kind, decimal Amount, string Currency, decimal? ToAmount, DateTime Date, string? Note,
    string? WalletName, string? ToWalletName, string? ToCurrency,
    string? SourceName, string? SourceIcon, string? SourceColor,
    string? CategoryName, string? CategoryIcon, string? CategoryColor, string? Person = null,
    decimal? BaseAmount = null, decimal? Rate = null,
    long? WalletId = null, long? ToWalletId = null, long? SourceId = null, long? CategoryId = null);
