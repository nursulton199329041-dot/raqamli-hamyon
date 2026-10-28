namespace Hamyon.Domain;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string DisplayName { get; set; } = "";
    /// <summary>Subject id from a future central SSO (Raqamli Passport / OIDC). Null for local accounts.</summary>
    public string? ExternalSubjectId { get; set; }
    public string? ExternalIssuer { get; set; }
    public string Locale { get; set; } = "uz";
    public string DefaultCurrency { get; set; } = "UZS";
    public string Theme { get; set; } = "system";
    public int FailedLoginCount { get; set; }
    public DateTimeOffset? LockoutUntil { get; set; }
    public bool IsDemo { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Rows that belong to one financial profile. Every query is scoped to the request's profile.</summary>
public interface IProfileOwned
{
    Guid ProfileId { get; set; }
}

/// <summary>
/// A separate set of books under one login account (e.g. "Shaxsiy", "Oila", "Biznes"). Wallets, categories,
/// operations and reports of one profile never mix with another's.
/// </summary>
public class Profile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#4D8DFF";
    public string Icon { get; set; } = "person";
    public string BaseCurrency { get; set; } = "UZS";
    public int SortOrder { get; set; }
    public bool IsArchived { get; set; }
    /// <summary>Bumped on every change; clients send it back to detect concurrent edits.</summary>
    public int Revision { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public Guid FamilyId { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

public class Wallet : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = "";
    public WalletType Type { get; set; }
    public string Icon { get; set; } = "wallet";
    public string Color { get; set; } = "#3B82F6";
    public string Currency { get; set; } = "UZS";
    public string? BankName { get; set; }
    /// <summary>Only a masked identifier such as "•••• 4775". Full card numbers / CVV are never stored.</summary>
    public string? MaskedNumber { get; set; }
    public string? Note { get; set; }
    public bool AllowOverdraft { get; set; }
    public bool IsArchived { get; set; }
    public int SortOrder { get; set; }
    public Guid LedgerAccountId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class LedgerAccount : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public LedgerAccountKind Kind { get; set; }
    public string Currency { get; set; } = "UZS";
    public string Name { get; set; } = "";
    /// <summary>Wallet / Category / IncomeSource / Debt id this account represents.</summary>
    public Guid? RefId { get; set; }
    public bool AllowNegative { get; set; }
    /// <summary>Cached sum of all lines; updated atomically with every posting.</summary>
    public decimal Balance { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class JournalEntry : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public TransactionType Type { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    // Denormalized, immutable summary used by history/analytics. Ledger lines remain the source of truth.
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "UZS";
    public Guid? WalletId { get; set; }
    public Guid? ToWalletId { get; set; }
    public decimal? ToAmount { get; set; }
    public string? ToCurrency { get; set; }
    public decimal? FxRate { get; set; }
    /// <summary>Date the rate applies to and where it came from ("manual", a provider name). Stored once, never re-priced.</summary>
    public DateOnly? RateDate { get; set; }
    public string? RateSource { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? IncomeSourceId { get; set; }
    public Guid? PersonId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? DebtId { get; set; }
    public string? Reason { get; set; }
    public string? Memo { get; set; }

    public string IdempotencyKey { get; set; } = "";
    public string RequestFingerprint { get; set; } = "";

    public Guid? ReversalOfId { get; set; }
    public Guid? ReversedById { get; set; }
    public Guid? ReplacesId { get; set; }
    public DateTimeOffset? ReversedAt { get; set; }

    public List<LedgerLine> Lines { get; set; } = new();
}

public class LedgerLine : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JournalEntryId { get; set; }
    public Guid LedgerAccountId { get; set; }
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    /// <summary>Signed: positive increases the account balance, negative decreases it. Per entry and currency the lines sum to zero.</summary>
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "UZS";
    /// <summary>Project bucket this money belongs to (wallet lines only). Null = unallocated.</summary>
    public Guid? ProjectId { get; set; }
}

public class Category : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "tag";
    public string Color { get; set; } = "#EF4444";
    public decimal? MonthlyLimit { get; set; }
    public string? LimitCurrency { get; set; }
    public bool IsArchived { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class IncomeSource : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "briefcase";
    public string Color { get; set; } = "#22C55E";
    public bool IsArchived { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Person : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Project : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "folder";
    public string Color { get; set; } = "#8B5CF6";
    public string Currency { get; set; } = "UZS";
    public string? Note { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Debt : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public Guid PersonId { get; set; }
    public DebtDirection Direction { get; set; }
    public string Currency { get; set; } = "UZS";
    public decimal Principal { get; set; }
    public decimal Outstanding { get; set; }
    public DateTimeOffset? DueDate { get; set; }
    public DebtStatus Status { get; set; }
    public Guid? ProjectId { get; set; }
    public string? Reason { get; set; }
    public string? Note { get; set; }
    public Guid LedgerAccountId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Attachment : IProfileOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid ProfileId { get; set; }
    public Guid JournalEntryId { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public string Sha256 { get; set; } = "";
    public string StorageKey { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public string Action { get; set; } = "";
    public string? EntityType { get; set; }
    public Guid? EntityId { get; set; }
    public string? Detail { get; set; }
    public string? Ip { get; set; }
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
}
