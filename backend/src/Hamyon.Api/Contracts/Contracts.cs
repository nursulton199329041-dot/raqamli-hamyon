using Hamyon.Domain;

namespace Hamyon.Api.Contracts;

// ---- auth ----
public sealed record RegisterRequest(string Email, string Password, string DisplayName, string? Locale);
public sealed record LoginRequest(string Email, string Password);
public sealed record RefreshRequest(string RefreshToken);
public sealed record AuthResponse(string AccessToken, string RefreshToken, DateTimeOffset AccessExpiresAt, UserDto User);
public sealed record UserDto(Guid Id, string Email, string DisplayName, string Locale, string DefaultCurrency, string Theme);
public sealed record UpdateProfileRequest(string? DisplayName, string? Locale, string? DefaultCurrency, string? Theme);

// ---- catalogs ----
public sealed record WalletRequest(string Name, WalletType Type, string Currency, decimal InitialBalance, string? Icon,
    string? Color, string? BankName, string? MaskedNumber, string? Note, bool AllowOverdraft, string? ClientKey,
    Guid? Id = null, Guid? OpeningId = null);
public sealed record WalletUpdateRequest(string? Name, string? Icon, string? Color, string? BankName, string? MaskedNumber,
    string? Note, bool? AllowOverdraft, bool? IsArchived, int? SortOrder);
public sealed record WalletDto(Guid Id, string Name, WalletType Type, string Currency, decimal Balance, string Icon,
    string Color, string? BankName, string? MaskedNumber, string? Note, bool AllowOverdraft, bool IsArchived, int SortOrder);

public sealed record CategoryRequest(string Name, string? Icon, string? Color, Guid? ParentId, decimal? MonthlyLimit,
    string? LimitCurrency, int? SortOrder, Guid? Id = null);
public sealed record CategoryDto(Guid Id, string Name, string Icon, string Color, Guid? ParentId, decimal? MonthlyLimit,
    string? LimitCurrency, bool IsArchived, int SortOrder);

public sealed record IncomeSourceRequest(string Name, string? Icon, string? Color, int? SortOrder, Guid? Id = null);
public sealed record IncomeSourceDto(Guid Id, string Name, string Icon, string Color, bool IsArchived, int SortOrder);

public sealed record PersonRequest(string Name, string? Phone, string? Note);
public sealed record PersonDto(Guid Id, string Name, string? Phone, string? Note);

public sealed record ProjectRequest(string Name, string? Icon, string? Color, string Currency, string? Note);
public sealed record ProjectDto(Guid Id, string Name, string Icon, string Color, string Currency, string? Note, bool IsArchived);

// ---- operations ----
public sealed record IncomeRequest(Guid WalletId, decimal Amount, Guid? IncomeSourceId, Guid? PersonId, string? Reason,
    Guid? ProjectId, DateTimeOffset? OccurredAt, string? Memo, string? ClientKey, Guid? Id = null);
/// <summary>
/// Expense paid from <see cref="WalletId"/> (Amount is in the wallet's currency). When the expense is in another currency
/// (<see cref="ToCurrency"/>), give either the converted <see cref="ToAmount"/> or the <see cref="FxRate"/> (ToCurrency per
/// wallet unit); <see cref="RateDate"/> / <see cref="RateSource"/> record where the rate came from.
/// </summary>
public sealed record ExpenseRequest(Guid WalletId, decimal Amount, Guid CategoryId, Guid? PersonId, Guid? ProjectId,
    DateTimeOffset? OccurredAt, string? Memo, string? ClientKey, string? ToCurrency = null, decimal? ToAmount = null,
    decimal? FxRate = null, DateOnly? RateDate = null, string? RateSource = null, Guid? Id = null);
public sealed record TransferRequest(Guid FromWalletId, Guid ToWalletId, decimal Amount, decimal? ToAmount, decimal? FxRate,
    Guid? ProjectId, DateTimeOffset? OccurredAt, string? Memo, string? ClientKey, Guid? Id = null);
public sealed record DebtRequest(DebtDirection Direction, Guid? PersonId, string? PersonName, Guid WalletId, decimal Amount,
    DateTimeOffset? DueDate, string? Reason, Guid? ProjectId, DateTimeOffset? OccurredAt, string? Memo, string? ClientKey,
    Guid? Id = null, Guid? DebtId = null);
public sealed record RepayRequest(Guid WalletId, decimal Amount, DateTimeOffset? OccurredAt, string? Memo, string? ClientKey,
    Guid? Id = null);

public sealed record TransactionDto(Guid Id, TransactionType Type, DateTimeOffset OccurredAt, decimal Amount, string Currency,
    Guid? WalletId, Guid? ToWalletId, decimal? ToAmount, string? ToCurrency, decimal? FxRate, Guid? CategoryId,
    Guid? IncomeSourceId, Guid? PersonId, Guid? ProjectId, Guid? DebtId, string? Reason, string? Memo,
    Guid? ReversalOfId, Guid? ReversedById, Guid? ReplacesId, DateTimeOffset CreatedAt, DateOnly? RateDate = null,
    string? RateSource = null, Guid? ProfileId = null);

public sealed record OperationResult(TransactionDto Transaction, bool Replayed, DebtDto? Debt = null);

public sealed record DebtDto(Guid Id, Guid PersonId, DebtDirection Direction, string Currency, decimal Principal,
    decimal Outstanding, DateTimeOffset? DueDate, DebtStatus Status, Guid? ProjectId, string? Reason, string? Note,
    DateTimeOffset CreatedAt);

public sealed record ErrorResponse(string Code, string Message, Dictionary<string, string[]>? Fields = null);

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
