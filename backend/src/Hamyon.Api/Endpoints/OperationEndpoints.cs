using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Api.Ledger;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Endpoints;

public sealed record TransactionQuery(
    DateTimeOffset? From, DateTimeOffset? To, Guid? WalletId, Guid? CategoryId, Guid? ProjectId, Guid? SourceId,
    Guid? PersonId, TransactionType? Type, string? Currency, decimal? MinAmount, decimal? MaxAmount, string? Q,
    bool? IncludeReversed, int? Page, int? PageSize);

public static class OperationEndpoints
{
    public static void MapOperations(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/transactions").WithTags("Transactions").RequireAuthorization();

        g.MapPost("/income", async (IncomeRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.IncomeAsync(ctx.User.UserId(), r with { ClientKey = r.ClientKey ?? Common.HeaderKey(ctx) }, ct)))
            .Validate<IncomeRequest>();

        g.MapPost("/expense", async (ExpenseRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.ExpenseAsync(ctx.User.UserId(), r with { ClientKey = r.ClientKey ?? Common.HeaderKey(ctx) }, ct)))
            .Validate<ExpenseRequest>();

        g.MapPost("/transfer", async (TransferRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.TransferAsync(ctx.User.UserId(), r with { ClientKey = r.ClientKey ?? Common.HeaderKey(ctx) }, ct)))
            .Validate<TransferRequest>();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, [AsParameters] TransactionQuery q, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var page = Math.Max(1, q.Page ?? 1);
            var size = Math.Clamp(q.PageSize ?? 50, 1, 200);
            var query = TransactionFilter.Apply(db, uid, q);
            var total = await query.CountAsync(ct);
            var items = await query.OrderByDescending(e => e.OccurredAt).ThenByDescending(e => e.CreatedAt)
                .Skip((page - 1) * size).Take(size).ToListAsync(ct);
            return Results.Ok(new PagedResult<TransactionDto>(items.Select(FinanceService.Map).ToList(), total, page, size));
        });

        g.MapGet("/{id:guid}", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var e = await db.JournalEntries.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct)
                    ?? throw new NotFoundException("Transaction");
            var lines = await db.LedgerLines.AsNoTracking().Where(l => l.JournalEntryId == id)
                .Select(l => new { l.LedgerAccountId, l.Amount, l.Currency, l.ProjectId }).ToListAsync(ct);
            return Results.Ok(new { transaction = FinanceService.Map(e), lines });
        });

        g.MapPost("/{id:guid}/reverse", async (Guid id, ReverseRequest? r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.ReverseAsync(ctx.User.UserId(), id, r?.Memo, ct)));

        g.MapPut("/{id:guid}/income", async (Guid id, IncomeRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            return Results.Ok(await fin.CorrectAsync(uid, id, rid => fin.IncomeAsync(uid, r, ct, rid), ct));
        }).Validate<IncomeRequest>();

        g.MapPut("/{id:guid}/expense", async (Guid id, ExpenseRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            return Results.Ok(await fin.CorrectAsync(uid, id, rid => fin.ExpenseAsync(uid, r, ct, rid), ct));
        }).Validate<ExpenseRequest>();

        g.MapPut("/{id:guid}/transfer", async (Guid id, TransferRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            return Results.Ok(await fin.CorrectAsync(uid, id, rid => fin.TransferAsync(uid, r, ct, rid), ct));
        }).Validate<TransferRequest>();

        // ---- debts
        var d = app.MapGroup("/api/debts").WithTags("Debts").RequireAuthorization();

        d.MapGet("/", async (HttpContext ctx, AppDbContext db, DebtStatus? status, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var q = db.Debts.AsNoTracking().Where(x => x.UserId == uid);
            if (status is not null) q = q.Where(x => x.Status == status);
            var list = await q.OrderBy(x => x.Status).ThenBy(x => x.DueDate).ThenByDescending(x => x.CreatedAt).ToListAsync(ct);
            return Results.Ok(list.Select(FinanceService.Map));
        });

        d.MapPost("/", async (DebtRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.CreateDebtAsync(ctx.User.UserId(), r with { ClientKey = r.ClientKey ?? Common.HeaderKey(ctx) }, ct)))
            .Validate<DebtRequest>();

        d.MapPost("/{id:guid}/repay", async (Guid id, RepayRequest r, HttpContext ctx, FinanceService fin, CancellationToken ct) =>
            Results.Ok(await fin.RepayAsync(ctx.User.UserId(), id,
                r with { ClientKey = r.ClientKey ?? Common.HeaderKey(ctx) }, ct))).Validate<RepayRequest>();

        d.MapGet("/{id:guid}/history", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            if (!await db.Debts.AnyAsync(x => x.Id == id && x.UserId == uid, ct)) throw new NotFoundException("Debt");
            var items = await db.JournalEntries.AsNoTracking().Where(e => e.UserId == uid && e.DebtId == id)
                .OrderBy(e => e.OccurredAt).ThenBy(e => e.CreatedAt).ToListAsync(ct);
            return Results.Ok(items.Select(FinanceService.Map));
        });

        // ---- project / reconciliation views
        var v = app.MapGroup("/api").WithTags("Insights").RequireAuthorization();

        v.MapGet("/projects/{id:guid}/summary", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var p = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct)
                    ?? throw new NotFoundException("Project");
            var rows = await (from e in db.JournalEntries.AsNoTracking()
                              where e.UserId == uid && e.ProjectId == id && e.ReversedById == null && e.ReversalOfId == null
                              group e by new { e.Type, e.Currency } into grp
                              select new { grp.Key.Type, grp.Key.Currency, Total = grp.Sum(x => x.Amount) }).ToListAsync(ct);

            // Per-wallet allocation: how much of each wallet's real balance belongs to this project.
            var buckets = await (from l in db.LedgerLines.AsNoTracking()
                                 join a in db.LedgerAccounts.AsNoTracking() on l.LedgerAccountId equals a.Id
                                 join w in db.Wallets.AsNoTracking() on a.RefId equals w.Id
                                 where l.UserId == uid && l.ProjectId == id && a.Kind == LedgerAccountKind.Wallet
                                 group l by new { w.Id, w.Name, l.Currency } into grp
                                 select new { WalletId = grp.Key.Id, Wallet = grp.Key.Name, grp.Key.Currency, Allocated = grp.Sum(x => x.Amount) })
                .ToListAsync(ct);

            var income = rows.Where(x => x.Type == TransactionType.Income).GroupBy(x => x.Currency)
                .ToDictionary(g2 => g2.Key, g2 => g2.Sum(x => x.Total));
            var expense = rows.Where(x => x.Type == TransactionType.Expense).GroupBy(x => x.Currency)
                .ToDictionary(g2 => g2.Key, g2 => g2.Sum(x => x.Total));
            var remaining = buckets.GroupBy(b => b.Currency).ToDictionary(g2 => g2.Key, g2 => g2.Sum(x => x.Allocated));
            return Results.Ok(new { project = new ProjectDto(p.Id, p.Name, p.Icon, p.Color, p.Currency, p.Note, p.IsArchived),
                income, expense, remaining, wallets = buckets });
        });

        // Wallet balance == sum of its bucket lines == sum of all lines; project buckets add up to the wallet.
        v.MapGet("/reconciliation", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var accounts = await db.LedgerAccounts.AsNoTracking().Where(a => a.UserId == uid).ToListAsync(ct);
            var sums = await db.LedgerLines.AsNoTracking().Where(l => l.UserId == uid)
                .GroupBy(l => l.LedgerAccountId).Select(g2 => new { Id = g2.Key, Sum = g2.Sum(x => x.Amount) }).ToListAsync(ct);
            var sumMap = sums.ToDictionary(x => x.Id, x => x.Sum);
            var mismatches = accounts.Where(a => a.Balance != sumMap.GetValueOrDefault(a.Id)).Select(a => new
            {
                accountId = a.Id, a.Name, cached = a.Balance, ledger = sumMap.GetValueOrDefault(a.Id),
            }).ToList();
            var perCurrency = await db.LedgerLines.AsNoTracking().Where(l => l.UserId == uid)
                .GroupBy(l => l.Currency).Select(g2 => new { Currency = g2.Key, Net = g2.Sum(x => x.Amount) }).ToListAsync(ct);
            return Results.Ok(new
            {
                ok = mismatches.Count == 0 && perCurrency.All(x => x.Net == 0),
                mismatches, booksNetByCurrency = perCurrency,
            });
        });
    }
}

public sealed record ReverseRequest(string? Memo);

public static class TransactionFilter
{
    /// <summary>Shared by the history list, analytics and exports so every screen applies identical filtering.</summary>
    public static IQueryable<JournalEntry> Apply(AppDbContext db, Guid uid, TransactionQuery q)
    {
        var e = db.JournalEntries.AsNoTracking().Where(x => x.UserId == uid);
        if (q.IncludeReversed != true) e = e.Where(x => x.ReversedById == null && x.ReversalOfId == null);
        if (q.From is not null) e = e.Where(x => x.OccurredAt >= q.From);
        if (q.To is not null) e = e.Where(x => x.OccurredAt <= q.To);
        if (q.WalletId is not null) e = e.Where(x => x.WalletId == q.WalletId || x.ToWalletId == q.WalletId);
        if (q.CategoryId is not null) e = e.Where(x => x.CategoryId == q.CategoryId);
        if (q.ProjectId is not null) e = e.Where(x => x.ProjectId == q.ProjectId);
        if (q.SourceId is not null) e = e.Where(x => x.IncomeSourceId == q.SourceId);
        if (q.PersonId is not null) e = e.Where(x => x.PersonId == q.PersonId);
        if (q.Type is not null) e = e.Where(x => x.Type == q.Type);
        if (!string.IsNullOrWhiteSpace(q.Currency))
        {
            var c = q.Currency.Trim().ToUpperInvariant();
            e = e.Where(x => x.Currency == c || x.ToCurrency == c);
        }
        if (q.MinAmount is not null) e = e.Where(x => x.Amount >= q.MinAmount);
        if (q.MaxAmount is not null) e = e.Where(x => x.Amount <= q.MaxAmount);
        if (!string.IsNullOrWhiteSpace(q.Q))
        {
            var s = q.Q.Trim().ToLowerInvariant();
            var like = $"%{EscapeLike(s)}%";
            e = e.Where(x =>
                (x.Memo != null && EF.Functions.Like(x.Memo.ToLower(), like)) ||
                (x.Reason != null && EF.Functions.Like(x.Reason.ToLower(), like)) ||
                x.Amount.ToString()!.Contains(s) ||
                (x.PersonId != null && db.People.Any(p => p.Id == x.PersonId && EF.Functions.Like(p.Name.ToLower(), like))) ||
                (x.CategoryId != null && db.Categories.Any(c => c.Id == x.CategoryId && EF.Functions.Like(c.Name.ToLower(), like))) ||
                (x.IncomeSourceId != null && db.IncomeSources.Any(c => c.Id == x.IncomeSourceId && EF.Functions.Like(c.Name.ToLower(), like))) ||
                (x.ProjectId != null && db.Projects.Any(c => c.Id == x.ProjectId && EF.Functions.Like(c.Name.ToLower(), like))));
        }
        return e;
    }

    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
