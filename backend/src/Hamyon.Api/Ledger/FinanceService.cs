using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hamyon.Api.Ledger;

/// <summary>Business operations (income, expense, transfer, debts, reversal). All money moves through <see cref="ILedgerService"/>.</summary>
public sealed class FinanceService(AppDbContext db, ILedgerService ledger)
{
    private static readonly Guid NoRef = Guid.Empty;

    // ------------------------------------------------------------------ wallets

    public async Task<Wallet> CreateWalletAsync(Guid userId, WalletRequest r, CancellationToken ct)
    {
        var currency = Currencies.Normalize(r.Currency);
        if (!Currencies.IsSupported(currency)) throw new DomainException("currency.unsupported", $"Unsupported currency '{currency}'.");
        if (string.IsNullOrWhiteSpace(r.Name)) throw new DomainException("wallet.name_required", "Wallet name is required.");
        if (r.InitialBalance < 0 && !r.AllowOverdraft)
            throw new DomainException("wallet.negative_opening", "Negative opening balance requires overdraft to be allowed.");
        if (r.InitialBalance != 0)
        {
            var abs = Math.Abs(r.InitialBalance);
            Currencies.ValidateAmount(abs, currency, "initialBalance");
        }
        if (r.Id == Guid.Empty || r.OpeningId == Guid.Empty) throw new DomainException("sync.id_invalid", "Id cannot be empty.");
        if (r.Id is not null)
        {
            // an offline client re-sending its wallet: the first create wins, the repeat is a no-op
            var existing = await db.Wallets.AsNoTracking().FirstOrDefaultAsync(w => w.Id == r.Id && w.UserId == userId, ct);
            if (existing is not null) return existing;
        }

        return await InTransactionAsync(async () =>
        {
            var account = new LedgerAccount
            {
                UserId = userId, Kind = LedgerAccountKind.Wallet, Currency = currency, Name = r.Name.Trim(),
                AllowNegative = r.AllowOverdraft,
            };
            var wallet = new Wallet
            {
                Id = r.Id ?? Guid.NewGuid(), UserId = userId, Name = r.Name.Trim(), Type = r.Type, Currency = currency,
                Icon = r.Icon ?? "wallet", Color = r.Color ?? "#3B82F6", BankName = r.BankName,
                MaskedNumber = r.MaskedNumber, Note = r.Note, AllowOverdraft = r.AllowOverdraft,
                LedgerAccountId = account.Id,
                SortOrder = await db.Wallets.CountAsync(w => w.UserId == userId, ct),
            };
            account.RefId = wallet.Id;
            db.LedgerAccounts.Add(account);
            db.Wallets.Add(wallet);
            await db.SaveChangesAsync(ct);

            if (r.InitialBalance != 0)
            {
                var equity = await GetOrCreateAccountAsync(userId, LedgerAccountKind.Equity, NoRef, currency, "Opening balances", true, ct);
                await ledger.PostAsync(new PostingRequest
                {
                    UserId = userId, Type = TransactionType.Opening, OccurredAt = DateTimeOffset.UtcNow,
                    IdempotencyKey = $"open:{wallet.Id}", Amount = Math.Abs(r.InitialBalance), Currency = currency,
                    WalletId = wallet.Id, Memo = "Opening balance", EntryId = r.OpeningId,
                    Lines =
                    [
                        new PostingLine(account.Id, r.InitialBalance),
                        new PostingLine(equity.Id, -r.InitialBalance),
                    ],
                }, ct);
            }
            return wallet;
        }, ct);
    }

    /// <summary>Manual correction of the real balance to a counted value (creates an Adjustment entry).</summary>
    public async Task<OperationResult> AdjustBalanceAsync(Guid userId, Guid walletId, decimal newBalance, string? memo,
        string? clientKey, CancellationToken ct)
    {
        var wallet = await GetWalletAsync(userId, walletId, ct);
        var account = await db.LedgerAccounts.AsNoTracking().FirstAsync(a => a.Id == wallet.LedgerAccountId, ct);
        var delta = newBalance - account.Balance;
        if (delta == 0) throw new DomainException("adjust.no_change", "Balance already equals the requested value.");
        if (newBalance < 0 && !wallet.AllowOverdraft)
            throw new DomainException("wallet.insufficient_funds", "Balance cannot be negative.", 422);
        Currencies.ValidateAmount(Math.Abs(delta), wallet.Currency, "difference");
        var adj = await GetOrCreateAccountAsync(userId, LedgerAccountKind.Adjustment, NoRef, wallet.Currency, "Adjustments", true, ct);
        var res = await ledger.PostAsync(new PostingRequest
        {
            UserId = userId, Type = TransactionType.Adjustment, OccurredAt = DateTimeOffset.UtcNow,
            IdempotencyKey = Key(clientKey), Amount = Math.Abs(delta), Currency = wallet.Currency, WalletId = wallet.Id,
            Memo = memo ?? "Balance adjustment",
            Lines = [new PostingLine(account.Id, delta), new PostingLine(adj.Id, -delta)],
        }, ct);
        return ToResult(res);
    }

    // ------------------------------------------------------------------ income / expense / transfer

    public async Task<OperationResult> IncomeAsync(Guid userId, IncomeRequest r, CancellationToken ct, Guid? replaces = null)
    {
        var wallet = await GetWalletAsync(userId, r.WalletId, ct);
        Currencies.ValidateAmount(r.Amount, wallet.Currency);
        if (r.IncomeSourceId is not null) await EnsureOwnedAsync(db.IncomeSources, userId, r.IncomeSourceId.Value, "Income source", ct);
        if (r.PersonId is not null) await EnsureOwnedAsync(db.People, userId, r.PersonId.Value, "Person", ct);
        if (r.ProjectId is not null) await EnsureOwnedAsync(db.Projects, userId, r.ProjectId.Value, "Project", ct);

        var sourceAccount = await GetOrCreateAccountAsync(userId, LedgerAccountKind.IncomeSource,
            r.IncomeSourceId ?? NoRef, wallet.Currency, "Income", true, ct);
        var res = await ledger.PostAsync(new PostingRequest
        {
            UserId = userId, Type = TransactionType.Income, OccurredAt = r.OccurredAt ?? DateTimeOffset.UtcNow,
            IdempotencyKey = Key(r.ClientKey), Amount = r.Amount, Currency = wallet.Currency, WalletId = wallet.Id,
            IncomeSourceId = r.IncomeSourceId, PersonId = r.PersonId, ProjectId = r.ProjectId, Reason = r.Reason,
            Memo = r.Memo, ReplacesId = replaces, EntryId = r.Id,
            Lines = [new PostingLine(wallet.LedgerAccountId, r.Amount, r.ProjectId), new PostingLine(sourceAccount.Id, -r.Amount)],
        }, ct);
        return ToResult(res);
    }

    public async Task<OperationResult> ExpenseAsync(Guid userId, ExpenseRequest r, CancellationToken ct, Guid? replaces = null)
    {
        var wallet = await GetWalletAsync(userId, r.WalletId, ct);
        Currencies.ValidateAmount(r.Amount, wallet.Currency);
        await EnsureOwnedAsync(db.Categories, userId, r.CategoryId, "Category", ct);
        if (r.PersonId is not null) await EnsureOwnedAsync(db.People, userId, r.PersonId.Value, "Person", ct);
        if (r.ProjectId is not null) await EnsureOwnedAsync(db.Projects, userId, r.ProjectId.Value, "Project", ct);

        var occurred = r.OccurredAt ?? DateTimeOffset.UtcNow;
        var target = r.ToCurrency is null ? wallet.Currency : Currencies.Normalize(r.ToCurrency);
        if (target == wallet.Currency)
        {
            if ((r.ToAmount is not null && r.ToAmount != r.Amount) || r.FxRate is not null)
                throw new DomainException("expense.fx_same_currency", "Same-currency expense cannot carry a conversion.");
            var catAccount = await GetOrCreateAccountAsync(userId, LedgerAccountKind.ExpenseCategory,
                r.CategoryId, wallet.Currency, "Expense", true, ct);
            var res = await ledger.PostAsync(new PostingRequest
            {
                UserId = userId, Type = TransactionType.Expense, OccurredAt = occurred,
                IdempotencyKey = Key(r.ClientKey), Amount = r.Amount, Currency = wallet.Currency, WalletId = wallet.Id,
                CategoryId = r.CategoryId, PersonId = r.PersonId, ProjectId = r.ProjectId, Memo = r.Memo, ReplacesId = replaces,
                EntryId = r.Id,
                Lines = [new PostingLine(wallet.LedgerAccountId, -r.Amount, r.ProjectId), new PostingLine(catAccount.Id, r.Amount)],
            }, ct);
            return ToResult(res);
        }

        // Paid from a wallet in another currency (e.g. 12 USD -> 144 000 UZS): the wallet loses its own currency, the
        // category is charged in the expense currency, each leg balances against its FX clearing account (never mixed).
        if (!Currencies.IsSupported(target)) throw new DomainException("currency.unsupported", $"Unsupported currency '{target}'.");
        var (toAmount, rate) = Fx(r.Amount, r.ToAmount, r.FxRate, target);
        var source = CleanRateSource(r.RateSource);
        var fxCat = await GetOrCreateAccountAsync(userId, LedgerAccountKind.ExpenseCategory, r.CategoryId, target, "Expense", true, ct);
        var clearFrom = await GetOrCreateAccountAsync(userId, LedgerAccountKind.FxClearing, NoRef, wallet.Currency, "FX clearing", true, ct);
        var clearTo = await GetOrCreateAccountAsync(userId, LedgerAccountKind.FxClearing, NoRef, target, "FX clearing", true, ct);
        var fx = await ledger.PostAsync(new PostingRequest
        {
            UserId = userId, Type = TransactionType.Expense, OccurredAt = occurred,
            IdempotencyKey = Key(r.ClientKey), Amount = r.Amount, Currency = wallet.Currency, WalletId = wallet.Id,
            ToAmount = toAmount, ToCurrency = target, FxRate = rate,
            RateDate = r.RateDate ?? DateOnly.FromDateTime(occurred.UtcDateTime), RateSource = source,
            CategoryId = r.CategoryId, PersonId = r.PersonId, ProjectId = r.ProjectId, Memo = r.Memo, ReplacesId = replaces,
            EntryId = r.Id,
            Lines =
            [
                new PostingLine(wallet.LedgerAccountId, -r.Amount, r.ProjectId),
                new PostingLine(clearFrom.Id, r.Amount),
                new PostingLine(clearTo.Id, -toAmount),
                new PostingLine(fxCat.Id, toAmount),
            ],
        }, ct);
        return ToResult(fx);
    }

    public async Task<OperationResult> TransferAsync(Guid userId, TransferRequest r, CancellationToken ct, Guid? replaces = null)
    {
        if (r.FromWalletId == r.ToWalletId)
            throw new DomainException("transfer.same_wallet", "Cannot transfer to the same wallet.");
        var from = await GetWalletAsync(userId, r.FromWalletId, ct);
        var to = await GetWalletAsync(userId, r.ToWalletId, ct);
        if (r.ProjectId is not null) await EnsureOwnedAsync(db.Projects, userId, r.ProjectId.Value, "Project", ct);
        Currencies.ValidateAmount(r.Amount, from.Currency);

        decimal toAmount;
        decimal? rate = null;
        var lines = new List<PostingLine>();
        if (from.Currency == to.Currency)
        {
            if (r.ToAmount is not null && r.ToAmount != r.Amount)
                throw new DomainException("transfer.amount_mismatch", "Same-currency transfer cannot change the amount.");
            toAmount = r.Amount;
            lines.Add(new PostingLine(from.LedgerAccountId, -r.Amount, r.ProjectId));
            lines.Add(new PostingLine(to.LedgerAccountId, toAmount, r.ProjectId));
        }
        else
        {
            // Currencies are never mixed: each leg balances against its own FX clearing account.
            if (r.ToAmount is not null)
            {
                Currencies.ValidateAmount(r.ToAmount.Value, to.Currency, "toAmount");
                toAmount = r.ToAmount.Value;
                rate = Math.Round(toAmount / r.Amount, Currencies.RateScale, MidpointRounding.AwayFromZero);
            }
            else if (r.FxRate is not null)
            {
                rate = r.FxRate;
                toAmount = Currencies.Convert(r.Amount, r.FxRate.Value, to.Currency);
            }
            else throw new DomainException("transfer.rate_required", "Different currencies: provide toAmount or fxRate.");

            var clearFrom = await GetOrCreateAccountAsync(userId, LedgerAccountKind.FxClearing, NoRef, from.Currency, "FX clearing", true, ct);
            var clearTo = await GetOrCreateAccountAsync(userId, LedgerAccountKind.FxClearing, NoRef, to.Currency, "FX clearing", true, ct);
            lines.Add(new PostingLine(from.LedgerAccountId, -r.Amount, r.ProjectId));
            lines.Add(new PostingLine(clearFrom.Id, r.Amount));
            lines.Add(new PostingLine(clearTo.Id, -toAmount));
            lines.Add(new PostingLine(to.LedgerAccountId, toAmount, r.ProjectId));
        }

        var res = await ledger.PostAsync(new PostingRequest
        {
            UserId = userId, Type = TransactionType.Transfer, OccurredAt = r.OccurredAt ?? DateTimeOffset.UtcNow,
            IdempotencyKey = Key(r.ClientKey), Amount = r.Amount, Currency = from.Currency, WalletId = from.Id,
            ToWalletId = to.Id, ToAmount = toAmount, ToCurrency = to.Currency, FxRate = rate,
            ProjectId = r.ProjectId, Memo = r.Memo, ReplacesId = replaces, EntryId = r.Id, Lines = lines,
        }, ct);
        return ToResult(res);
    }

    // ------------------------------------------------------------------ debts

    public async Task<OperationResult> CreateDebtAsync(Guid userId, DebtRequest r, CancellationToken ct)
    {
        var key = Key(r.ClientKey);
        var prior = await db.JournalEntries.AsNoTracking().Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.UserId == userId && e.IdempotencyKey == key, ct);
        if (prior is not null)
        {
            var debt0 = prior.DebtId is null ? null : await db.Debts.AsNoTracking().FirstOrDefaultAsync(d => d.Id == prior.DebtId, ct);
            return new OperationResult(Map(prior), true, debt0 is null ? null : Map(debt0));
        }

        var wallet = await GetWalletAsync(userId, r.WalletId, ct);
        Currencies.ValidateAmount(r.Amount, wallet.Currency);
        if (r.ProjectId is not null) await EnsureOwnedAsync(db.Projects, userId, r.ProjectId.Value, "Project", ct);

        return await InTransactionAsync(async () =>
        {
            Guid personId;
            var known = r.PersonId is not null
                && await db.People.AsNoTracking().AnyAsync(p => p.Id == r.PersonId && p.UserId == userId, ct);
            if (known)
            {
                personId = r.PersonId!.Value;
            }
            else if (r.PersonId is not null && string.IsNullOrWhiteSpace(r.PersonName))
            {
                throw new NotFoundException("Person");
            }
            else if (!string.IsNullOrWhiteSpace(r.PersonName))
            {
                // an offline client names the new person and may also choose its id
                if (r.PersonId == Guid.Empty) throw new DomainException("sync.id_invalid", "Id cannot be empty.");
                var p = new Person { Id = r.PersonId ?? Guid.NewGuid(), UserId = userId, Name = r.PersonName.Trim() };
                db.People.Add(p);
                await db.SaveChangesAsync(ct);
                personId = p.Id;
            }
            else throw new DomainException("debt.person_required", "Person is required.");

            var account = new LedgerAccount
            {
                UserId = userId, Kind = LedgerAccountKind.Debt, Currency = wallet.Currency, Name = "Debt", AllowNegative = true,
            };
            if (r.DebtId == Guid.Empty) throw new DomainException("sync.id_invalid", "Id cannot be empty.");
            var debt = new Debt
            {
                Id = r.DebtId ?? Guid.NewGuid(), UserId = userId, PersonId = personId, Direction = r.Direction, Currency = wallet.Currency,
                Principal = r.Amount, Outstanding = r.Amount, DueDate = r.DueDate, Status = DebtStatus.Open,
                ProjectId = r.ProjectId, Reason = r.Reason, Note = r.Memo, LedgerAccountId = account.Id,
            };
            account.RefId = debt.Id;
            db.LedgerAccounts.Add(account);
            db.Debts.Add(debt);
            await db.SaveChangesAsync(ct);

            var borrow = r.Direction == DebtDirection.Borrowed;
            var res = await ledger.PostAsync(new PostingRequest
            {
                UserId = userId, Type = borrow ? TransactionType.DebtBorrow : TransactionType.DebtLend,
                OccurredAt = r.OccurredAt ?? DateTimeOffset.UtcNow, IdempotencyKey = key,
                Amount = r.Amount, Currency = wallet.Currency, WalletId = wallet.Id, PersonId = personId,
                ProjectId = r.ProjectId, DebtId = debt.Id, Reason = r.Reason, Memo = r.Memo, EntryId = r.Id,
                Lines =
                [
                    new PostingLine(wallet.LedgerAccountId, borrow ? r.Amount : -r.Amount, r.ProjectId),
                    new PostingLine(account.Id, borrow ? -r.Amount : r.Amount),
                ],
            }, ct);
            return new OperationResult(Map(res.Entry), res.Replayed, Map(debt));
        }, ct);
    }

    public async Task<OperationResult> RepayAsync(Guid userId, Guid debtId, RepayRequest r, CancellationToken ct)
    {
        var debt = await db.Debts.AsNoTracking().FirstOrDefaultAsync(d => d.Id == debtId && d.UserId == userId, ct)
                   ?? throw new NotFoundException("Debt");
        var key = Key(r.ClientKey);
        var prior = await db.JournalEntries.AsNoTracking().Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.UserId == userId && e.IdempotencyKey == key, ct);
        if (prior is not null) return new OperationResult(Map(prior), true, Map(debt));

        if (debt.Status != DebtStatus.Open) throw new DomainException("debt.not_open", "Debt is not open.", 409);
        var wallet = await GetWalletAsync(userId, r.WalletId, ct);
        if (wallet.Currency != debt.Currency)
            throw new DomainException("debt.currency_mismatch", "Repayment wallet must use the debt currency.");
        Currencies.ValidateAmount(r.Amount, debt.Currency);
        if (r.Amount > debt.Outstanding)
            throw new DomainException("debt.overpayment", "Amount exceeds the outstanding debt.", 422);

        var borrowed = debt.Direction == DebtDirection.Borrowed;
        return await InTransactionAsync(async () =>
        {
            var amount = r.Amount;
            var updated = await db.Debts
                .Where(d => d.Id == debtId && d.Status == DebtStatus.Open && d.Outstanding >= amount)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(d => d.Outstanding, d => d.Outstanding - amount)
                    .SetProperty(d => d.Status, d => d.Outstanding - amount == 0 ? DebtStatus.Settled : DebtStatus.Open), ct);
            if (updated == 0) throw new DomainException("debt.overpayment", "Amount exceeds the outstanding debt.", 422);

            var res = await ledger.PostAsync(new PostingRequest
            {
                UserId = userId, Type = borrowed ? TransactionType.DebtRepayment : TransactionType.DebtCollection,
                OccurredAt = r.OccurredAt ?? DateTimeOffset.UtcNow, IdempotencyKey = key,
                Amount = amount, Currency = debt.Currency, WalletId = wallet.Id, PersonId = debt.PersonId,
                ProjectId = debt.ProjectId, DebtId = debt.Id, Memo = r.Memo, EntryId = r.Id,
                Lines =
                [
                    new PostingLine(wallet.LedgerAccountId, borrowed ? -amount : amount, debt.ProjectId),
                    new PostingLine(debt.LedgerAccountId, borrowed ? amount : -amount),
                ],
            }, ct);
            var fresh = await db.Debts.AsNoTracking().FirstAsync(d => d.Id == debtId, ct);
            return new OperationResult(Map(res.Entry), res.Replayed, Map(fresh));
        }, ct);
    }

    // ------------------------------------------------------------------ reversal / correction

    /// <summary>Posts a mirror entry. Original is never modified except for the ReversedById link.</summary>
    public async Task<OperationResult> ReverseAsync(Guid userId, Guid entryId, string? memo, CancellationToken ct,
        Guid? reversalId = null)
    {
        var original = await db.JournalEntries.AsNoTracking().Include(e => e.Lines)
            .FirstOrDefaultAsync(e => e.Id == entryId && e.UserId == userId, ct) ?? throw new NotFoundException("Transaction");

        var key = $"rev:{entryId}";
        if (original.Type is TransactionType.Reversal or TransactionType.Opening)
            throw new DomainException("reverse.not_allowed", "This entry cannot be reversed.", 409);
        if (original.ReversedById is not null)
        {
            var rev = await db.JournalEntries.AsNoTracking().FirstAsync(e => e.Id == original.ReversedById, ct);
            return new OperationResult(Map(rev), true);
        }

        return await InTransactionAsync(async () =>
        {
            await AdjustDebtForReversalAsync(original, ct);

            var res = await ledger.PostAsync(new PostingRequest
            {
                UserId = userId, Type = TransactionType.Reversal, OccurredAt = DateTimeOffset.UtcNow, IdempotencyKey = key,
                Amount = original.Amount, Currency = original.Currency, WalletId = original.WalletId,
                ToWalletId = original.ToWalletId, ToAmount = original.ToAmount, ToCurrency = original.ToCurrency,
                FxRate = original.FxRate, RateDate = original.RateDate, RateSource = original.RateSource,
                CategoryId = original.CategoryId, IncomeSourceId = original.IncomeSourceId,
                PersonId = original.PersonId, ProjectId = original.ProjectId, DebtId = original.DebtId,
                Reason = original.Reason, Memo = memo ?? $"Reversal of {original.Id}", ReversalOfId = original.Id,
                EntryId = reversalId,
                Lines = original.Lines.Select(l => new PostingLine(l.LedgerAccountId, -l.Amount, l.ProjectId)).ToList(),
            }, ct);

            var now = DateTimeOffset.UtcNow;
            var linked = await db.JournalEntries
                .Where(e => e.Id == original.Id && e.ReversedById == null)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.ReversedById, res.Entry.Id).SetProperty(e => e.ReversedAt, now), ct);
            if (linked == 0) throw new DomainException("reverse.already", "Transaction was already reversed.", 409);
            return new OperationResult(Map(res.Entry), res.Replayed);
        }, ct);
    }

    /// <summary>Correction = atomic reversal of the original + a new replacement entry linked to it.</summary>
    public async Task<OperationResult> CorrectAsync(Guid userId, Guid entryId, Func<Guid, Task<OperationResult>> repost, CancellationToken ct)
    {
        return await InTransactionAsync(async () =>
        {
            var reversal = await ReverseAsync(userId, entryId, "Corrected", ct);
            if (reversal.Replayed)
                throw new DomainException("reverse.already", "Transaction was already reversed.", 409);
            return await repost(entryId);
        }, ct);
    }

    private async Task AdjustDebtForReversalAsync(JournalEntry original, CancellationToken ct)
    {
        if (original.DebtId is null) return;
        var debtId = original.DebtId.Value;
        var amount = original.Amount;
        switch (original.Type)
        {
            case TransactionType.DebtBorrow or TransactionType.DebtLend:
                var cancelled = await db.Debts
                    .Where(d => d.Id == debtId && d.Outstanding == d.Principal && d.Status == DebtStatus.Open)
                    .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, DebtStatus.Cancelled)
                        .SetProperty(d => d.Outstanding, 0m), ct);
                if (cancelled == 0)
                    throw new DomainException("debt.has_repayments", "Debt already has repayments; reverse them first.", 409);
                break;
            case TransactionType.DebtRepayment or TransactionType.DebtCollection:
                var restored = await db.Debts
                    .Where(d => d.Id == debtId && d.Status != DebtStatus.Cancelled && d.Outstanding + amount <= d.Principal)
                    .ExecuteUpdateAsync(s => s.SetProperty(d => d.Outstanding, d => d.Outstanding + amount)
                        .SetProperty(d => d.Status, DebtStatus.Open), ct);
                if (restored == 0) throw new DomainException("debt.reverse_failed", "Cannot restore this debt.", 409);
                break;
        }
    }

    // ------------------------------------------------------------------ helpers

    private async Task<T> InTransactionAsync<T>(Func<Task<T>> work, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is not null) return await work();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var result = await work();
            await tx.CommitAsync(ct);
            return result;
        }
        catch
        {
            await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            throw;
        }
    }

    private async Task<Wallet> GetWalletAsync(Guid userId, Guid walletId, CancellationToken ct) =>
        await db.Wallets.AsNoTracking().FirstOrDefaultAsync(w => w.Id == walletId && w.UserId == userId, ct)
        ?? throw new NotFoundException("Wallet");

    private static async Task EnsureOwnedAsync<T>(DbSet<T> set, Guid userId, Guid id, string what, CancellationToken ct)
        where T : class
    {
        var exists = await set.AsNoTracking()
            .AnyAsync(e => EF.Property<Guid>(e, "Id") == id && EF.Property<Guid>(e, "UserId") == userId, ct);
        if (!exists) throw new NotFoundException(what);
    }

    /// <summary>Counter-accounts are created lazily, one per (kind, ref, currency). Races resolve via unique index.</summary>
    private async Task<LedgerAccount> GetOrCreateAccountAsync(Guid userId, LedgerAccountKind kind, Guid refId, string currency,
        string name, bool allowNegative, CancellationToken ct)
    {
        var found = await db.LedgerAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.UserId == userId && a.Kind == kind && a.RefId == refId && a.Currency == currency, ct);
        if (found is not null) return found;

        var acc = new LedgerAccount
        {
            UserId = userId, Kind = kind, RefId = refId, Currency = currency, Name = name, AllowNegative = allowNegative,
        };
        try
        {
            if (db.Database.CurrentTransaction is not null)
            {
                // Savepoint so a unique violation does not poison the surrounding transaction.
                await db.Database.CurrentTransaction.CreateSavepointAsync("acc", ct);
                db.LedgerAccounts.Add(acc);
                try
                {
                    await db.SaveChangesAsync(ct);
                    await db.Database.CurrentTransaction.ReleaseSavepointAsync("acc", ct);
                }
                catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
                {
                    await db.Database.CurrentTransaction.RollbackToSavepointAsync("acc", ct);
                    db.Entry(acc).State = EntityState.Detached;
                    return await db.LedgerAccounts.AsNoTracking().FirstAsync(
                        a => a.UserId == userId && a.Kind == kind && a.RefId == refId && a.Currency == currency, ct);
                }
            }
            else
            {
                db.LedgerAccounts.Add(acc);
                await db.SaveChangesAsync(ct);
            }
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.Entry(acc).State = EntityState.Detached;
            return await db.LedgerAccounts.AsNoTracking().FirstAsync(
                a => a.UserId == userId && a.Kind == kind && a.RefId == refId && a.Currency == currency, ct);
        }
        db.Entry(acc).State = EntityState.Detached;
        return acc;
    }

    /// <summary>
    /// Converted amount and rate from either the user's converted amount (rate derived, 8 places) or the rate (amount
    /// rounded half away from zero to the target currency) – the same rules transfers use.
    /// </summary>
    private static (decimal ToAmount, decimal Rate) Fx(decimal amount, decimal? toAmount, decimal? rate, string target)
    {
        if (toAmount is not null)
        {
            Currencies.ValidateAmount(toAmount.Value, target, "toAmount");
            return (toAmount.Value, Math.Round(toAmount.Value / amount, Currencies.RateScale, MidpointRounding.AwayFromZero));
        }
        if (rate is not null) return (Currencies.Convert(amount, rate.Value, target), rate.Value);
        throw new DomainException("fx.rate_required", "Different currencies: provide toAmount or fxRate.");
    }

    private static string CleanRateSource(string? s)
    {
        var v = string.IsNullOrWhiteSpace(s) ? "manual" : s.Trim();
        if (v.Length > 40) throw new DomainException("fx.source_invalid", "Rate source is too long.");
        return v;
    }

    private static string Key(string? clientKey) =>
        string.IsNullOrWhiteSpace(clientKey) ? $"srv:{Guid.NewGuid():N}" : clientKey.Trim();

    private static OperationResult ToResult(PostResult r) => new(Map(r.Entry), r.Replayed);

    public static TransactionDto Map(JournalEntry e) => new(e.Id, e.Type, e.OccurredAt, e.Amount, e.Currency, e.WalletId,
        e.ToWalletId, e.ToAmount, e.ToCurrency, e.FxRate, e.CategoryId, e.IncomeSourceId, e.PersonId, e.ProjectId, e.DebtId,
        e.Reason, e.Memo, e.ReversalOfId, e.ReversedById, e.ReplacesId, e.CreatedAt, e.RateDate, e.RateSource, e.ProfileId);

    public static DebtDto Map(Debt d) => new(d.Id, d.PersonId, d.Direction, d.Currency, d.Principal, d.Outstanding,
        d.DueDate, d.Status, d.ProjectId, d.Reason, d.Note, d.CreatedAt);
}
