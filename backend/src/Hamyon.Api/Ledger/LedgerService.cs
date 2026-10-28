using System.Security.Cryptography;
using System.Text;
using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hamyon.Api.Ledger;

public sealed record PostingLine(Guid AccountId, decimal Amount, Guid? ProjectId = null);

/// <summary>Everything needed to write one balanced journal entry.</summary>
public sealed class PostingRequest
{
    public required Guid UserId { get; init; }
    public required TransactionType Type { get; init; }
    public required string IdempotencyKey { get; init; }
    public required IReadOnlyList<PostingLine> Lines { get; init; }
    public required DateTimeOffset OccurredAt { get; init; }

    public decimal Amount { get; init; }
    public string Currency { get; init; } = "UZS";
    public Guid? WalletId { get; init; }
    public Guid? ToWalletId { get; init; }
    public decimal? ToAmount { get; init; }
    public string? ToCurrency { get; init; }
    public decimal? FxRate { get; init; }
    public DateOnly? RateDate { get; init; }
    public string? RateSource { get; init; }
    public Guid? CategoryId { get; init; }
    public Guid? IncomeSourceId { get; init; }
    public Guid? PersonId { get; init; }
    public Guid? ProjectId { get; init; }
    public Guid? DebtId { get; init; }
    public string? Reason { get; init; }
    public string? Memo { get; init; }
    public Guid? ReversalOfId { get; init; }
    public Guid? ReplacesId { get; init; }

    /// <summary>Deterministic fingerprint of the business content, used to detect key reuse with a different body.</summary>
    public string Fingerprint()
    {
        var sb = new StringBuilder();
        sb.Append((int)Type).Append('|').Append(Amount).Append('|').Append(Currency).Append('|')
          .Append(WalletId).Append('|').Append(ToWalletId).Append('|').Append(ToAmount).Append('|').Append(FxRate).Append('|')
          .Append(CategoryId).Append('|').Append(IncomeSourceId).Append('|').Append(PersonId).Append('|')
          .Append(ProjectId).Append('|').Append(DebtId).Append('|').Append(ReversalOfId);
        // cross-currency fields are appended only when present, so fingerprints of older requests stay unchanged
        if (ToCurrency is not null && ToWalletId is null) sb.Append('|').Append(ToCurrency);
        if (RateDate is not null || RateSource is not null) sb.Append('|').Append(RateDate?.ToString("yyyy-MM-dd")).Append('|').Append(RateSource);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()))).ToLowerInvariant();
    }
}

public sealed record PostResult(JournalEntry Entry, bool Replayed);

public interface ILedgerService
{
    Task<PostResult> PostAsync(PostingRequest request, CancellationToken ct = default);
}

/// <summary>
/// The only place that writes ledger lines and changes account balances. Guarantees:
/// balanced entries per currency, atomic multi-account update, no accidental overdraft under concurrency
/// (conditional UPDATE), and idempotent replay of the same key.
/// </summary>
public sealed class LedgerService(AppDbContext db) : ILedgerService
{
    public async Task<PostResult> PostAsync(PostingRequest r, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(r.IdempotencyKey) || r.IdempotencyKey.Length > 100)
            throw new DomainException("idempotency.invalid", "Idempotency key is required (max 100 chars).");

        var fingerprint = r.Fingerprint();
        var existing = await FindByKeyAsync(r.UserId, r.IdempotencyKey, ct);
        if (existing is not null) return Replay(existing, fingerprint);

        if (r.Lines.Count < 2) throw new DomainException("ledger.too_few_lines", "A journal entry needs at least two lines.");

        var accountIds = r.Lines.Select(l => l.AccountId).Distinct().ToList();
        var accounts = await db.LedgerAccounts.AsNoTracking()
            .Where(a => a.UserId == r.UserId && accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
        if (accounts.Count != accountIds.Count) throw new NotFoundException("Account");

        // Balanced per currency; zero-valued lines are meaningless.
        foreach (var l in r.Lines)
            if (l.Amount == 0) throw new DomainException("ledger.zero_line", "Zero amount line.");
        var unbalanced = r.Lines.GroupBy(l => accounts[l.AccountId].Currency).FirstOrDefault(g => g.Sum(x => x.Amount) != 0);
        if (unbalanced is not null)
            throw new DomainException("ledger.unbalanced", $"Entry does not balance in {unbalanced.Key}.", 500);

        var archived = await db.Wallets.AsNoTracking()
            .Where(w => w.UserId == r.UserId && w.IsArchived && accountIds.Contains(w.LedgerAccountId))
            .Select(w => w.Name).FirstOrDefaultAsync(ct);
        if (archived is not null && r.Type != TransactionType.Reversal)
            throw new DomainException("wallet.archived", $"Wallet '{archived}' is archived.", 409);

        var entry = new JournalEntry
        {
            UserId = r.UserId, Type = r.Type, OccurredAt = r.OccurredAt.ToUniversalTime(),
            Amount = r.Amount, Currency = r.Currency, WalletId = r.WalletId, ToWalletId = r.ToWalletId,
            ToAmount = r.ToAmount, ToCurrency = r.ToCurrency, FxRate = r.FxRate, RateDate = r.RateDate, RateSource = r.RateSource,
            CategoryId = r.CategoryId, IncomeSourceId = r.IncomeSourceId, PersonId = r.PersonId,
            ProjectId = r.ProjectId, DebtId = r.DebtId, Reason = r.Reason, Memo = r.Memo,
            IdempotencyKey = r.IdempotencyKey, RequestFingerprint = fingerprint,
            ReversalOfId = r.ReversalOfId, ReplacesId = r.ReplacesId,
        };
        foreach (var l in r.Lines)
            entry.Lines.Add(new LedgerLine
            {
                JournalEntryId = entry.Id, UserId = r.UserId, LedgerAccountId = l.AccountId,
                Amount = l.Amount, Currency = accounts[l.AccountId].Currency, ProjectId = l.ProjectId,
            });

        // Join an ambient transaction (e.g. reverse + repost) or own a new one.
        var owned = db.Database.CurrentTransaction is null;
        var tx = db.Database.CurrentTransaction ?? await db.Database.BeginTransactionAsync(ct);
        try
        {
            db.JournalEntries.Add(entry);
            await db.SaveChangesAsync(ct);

            // Net delta per account, applied in a stable order to avoid deadlocks.
            var deltas = r.Lines.GroupBy(l => l.AccountId).Select(g => (Id: g.Key, Delta: g.Sum(x => x.Amount)))
                .OrderBy(x => x.Id);
            foreach (var (id, delta) in deltas)
            {
                var acc = accounts[id];
                var allowNegative = acc.AllowNegative || delta >= 0;
                var affected = await db.LedgerAccounts
                    .Where(a => a.Id == id && (allowNegative || a.Balance + delta >= 0))
                    .ExecuteUpdateAsync(s => s.SetProperty(a => a.Balance, a => a.Balance + delta), ct);
                if (affected == 0)
                    throw new InsufficientFundsException(acc.Name);
            }

            if (owned) await tx.CommitAsync(ct);
            return new PostResult(entry, false);
        }
        catch (DbUpdateException ex) when (owned && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent request with the same idempotency key won the race.
            await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var winner = await FindByKeyAsync(r.UserId, r.IdempotencyKey, ct)
                         ?? throw new DomainException("ledger.conflict", "Concurrent conflict, retry.", 409);
            return Replay(winner, fingerprint);
        }
        catch
        {
            if (owned) await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            throw;
        }
        finally
        {
            if (owned) await tx.DisposeAsync();
        }
    }

    private static PostResult Replay(JournalEntry existing, string fingerprint)
    {
        if (existing.RequestFingerprint != fingerprint)
            throw new DomainException("idempotency.key_reused", "Idempotency key was already used with different data.", 409);
        return new PostResult(existing, true);
    }

    private Task<JournalEntry?> FindByKeyAsync(Guid userId, string key, CancellationToken ct) =>
        db.JournalEntries.AsNoTracking().Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.UserId == userId && e.IdempotencyKey == key, ct);
}
