using System.Text.Json;
using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Api.Ledger;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Endpoints;

public sealed record SyncOperation(string ClientOperationId, string Kind, JsonElement Payload, Guid? TargetId);
public sealed record SyncPushRequest(IReadOnlyList<SyncOperation> Operations);
public sealed record SyncResult(string ClientOperationId, string Status, string? ErrorCode, string? Message,
    OperationResult? Result);

/// <summary>
/// Offline queue replay. Each operation carries a client generated id that doubles as the ledger idempotency key,
/// so re-sending a batch after a dropped response can never create duplicates. The server is the only authority
/// for balances: an operation that cannot be applied (e.g. insufficient funds) is reported back, never forced.
/// </summary>
public static class SyncEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapSync(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/sync").WithTags("Sync").RequireAuthorization();

        g.MapPost("/push", async (SyncPushRequest req, HttpContext ctx, FinanceService fin, AppDbContext db, CancellationToken ct) =>
        {
            if (req.Operations.Count > 200) throw new DomainException("sync.too_many", "At most 200 operations per batch.");
            var uid = ctx.User.UserId();
            var results = new List<SyncResult>();
            foreach (var op in req.Operations)
            {
                if (string.IsNullOrWhiteSpace(op.ClientOperationId) || op.ClientOperationId.Length > 100)
                {
                    results.Add(new SyncResult(op.ClientOperationId ?? "", "rejected", "idempotency.invalid", "Invalid client operation id.", null));
                    continue;
                }
                try
                {
                    var key = op.ClientOperationId;
                    OperationResult res = op.Kind switch
                    {
                        "income" => await fin.IncomeAsync(uid, Read<IncomeRequest>(op) with { ClientKey = key }, ct),
                        "expense" => await fin.ExpenseAsync(uid, Read<ExpenseRequest>(op) with { ClientKey = key }, ct),
                        "transfer" => await fin.TransferAsync(uid, Read<TransferRequest>(op) with { ClientKey = key }, ct),
                        "debt" => await fin.CreateDebtAsync(uid, Read<DebtRequest>(op) with { ClientKey = key }, ct),
                        "repay" => await fin.RepayAsync(uid, op.TargetId ?? throw new DomainException("sync.target", "Debt id required."),
                            Read<RepayRequest>(op) with { ClientKey = key }, ct),
                        _ => throw new DomainException("sync.kind", $"Unknown operation kind '{op.Kind}'."),
                    };
                    results.Add(new SyncResult(key, res.Replayed ? "duplicate" : "applied", null, null, res));
                }
                catch (DomainException ex)
                {
                    results.Add(new SyncResult(op.ClientOperationId, "rejected", ex.Code, ex.Message, null));
                }
                catch (JsonException)
                {
                    results.Add(new SyncResult(op.ClientOperationId, "rejected", "sync.payload", "Malformed payload.", null));
                }
                finally
                {
                    db.ChangeTracker.Clear();
                }
            }
            return Results.Ok(new { results });
        });

        // Delta feed: everything created since the cursor + full catalogs (they are small).
        g.MapGet("/pull", async (HttpContext ctx, AppDbContext db, DateTimeOffset? since, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var cursor = DateTimeOffset.UtcNow;
            var q = db.JournalEntries.AsNoTracking().Where(e => e.UserId == uid);
            if (since is not null) q = q.Where(e => e.CreatedAt > since || (e.ReversedAt != null && e.ReversedAt > since));
            var entries = await q.OrderBy(e => e.CreatedAt).Take(1000).ToListAsync(ct);

            var wallets = await (from w in db.Wallets.AsNoTracking()
                                 join a in db.LedgerAccounts.AsNoTracking() on w.LedgerAccountId equals a.Id
                                 where w.UserId == uid
                                 select new WalletDto(w.Id, w.Name, w.Type, w.Currency, a.Balance, w.Icon, w.Color,
                                     w.BankName, w.MaskedNumber, w.Note, w.AllowOverdraft, w.IsArchived, w.SortOrder)).ToListAsync(ct);
            var categories = await db.Categories.AsNoTracking().Where(c => c.UserId == uid).ToListAsync(ct);
            var sources = await db.IncomeSources.AsNoTracking().Where(c => c.UserId == uid).ToListAsync(ct);
            var people = await db.People.AsNoTracking().Where(c => c.UserId == uid).ToListAsync(ct);
            var projects = await db.Projects.AsNoTracking().Where(c => c.UserId == uid).ToListAsync(ct);
            var debts = await db.Debts.AsNoTracking().Where(c => c.UserId == uid).ToListAsync(ct);

            return Results.Ok(new
            {
                cursor,
                hasMore = entries.Count == 1000,
                transactions = entries.Select(FinanceService.Map),
                wallets,
                categories = categories.Select(c => new CategoryDto(c.Id, c.Name, c.Icon, c.Color, c.ParentId, c.MonthlyLimit,
                    c.LimitCurrency, c.IsArchived, c.SortOrder)),
                incomeSources = sources.Select(s => new IncomeSourceDto(s.Id, s.Name, s.Icon, s.Color, s.IsArchived, s.SortOrder)),
                people = people.Select(p => new PersonDto(p.Id, p.Name, p.Phone, p.Note)),
                projects = projects.Select(p => new ProjectDto(p.Id, p.Name, p.Icon, p.Color, p.Currency, p.Note, p.IsArchived)),
                debts = debts.Select(FinanceService.Map),
            });
        });
    }

    private static T Read<T>(SyncOperation op) =>
        op.Payload.Deserialize<T>(Json) ?? throw new JsonException("empty payload");
}
