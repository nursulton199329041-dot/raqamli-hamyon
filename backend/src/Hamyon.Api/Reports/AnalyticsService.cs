using System.Globalization;
using Hamyon.Api.Data;
using Hamyon.Api.Endpoints;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Reports;

public sealed record CurrencyTotals(string Currency, decimal Income, decimal Expense, decimal NetFlow, decimal Borrowed,
    decimal Lent, decimal DebtRepaid, decimal DebtCollected);

public sealed record DebtPosition(string Currency, decimal IOwe, decimal OwedToMe);

public sealed record WalletBalance(Guid WalletId, string Name, string Currency, decimal Balance);

public sealed record TopExpense(Guid Id, DateTimeOffset OccurredAt, decimal Amount, string Currency, string? Category, string? Memo);

public sealed record SummaryResult(IReadOnlyList<CurrencyTotals> Totals, IReadOnlyList<DebtPosition> Debts,
    IReadOnlyList<WalletBalance> Wallets, IReadOnlyList<TopExpense> TopExpenses);

public sealed record SeriesPoint(string Period, DateTimeOffset Start, string Currency, decimal Income, decimal Expense);

public sealed record BreakdownRow(Guid? Id, string Name, string Currency, decimal Total, decimal Percent, int Count);

internal sealed record FlowRow(string Currency, decimal Amount, Guid? CategoryId, Guid? WalletId, Guid? ProjectId,
    Guid? PersonId, Guid? IncomeSourceId);

public sealed record BudgetStatus(Guid CategoryId, string Name, string Currency, decimal Limit, decimal Spent,
    decimal Remaining, decimal Percent, bool Exceeded);

/// <summary>
/// Read-side analytics built from immutable journal summaries. Different currencies are always reported
/// side by side – never summed together. Debts/transfers/openings never leak into income or expense.
/// </summary>
public sealed class AnalyticsService(AppDbContext db)
{
    public async Task<SummaryResult> SummaryAsync(Guid uid, TransactionQuery q, CancellationToken ct)
    {
        var rows = await TransactionFilter.Apply(db, uid, q).Select(e => new
        {
            e.Id, e.Type, e.Currency, e.Amount, e.OccurredAt, e.CategoryId, e.Memo,
        }).ToListAsync(ct);

        decimal Sum(IEnumerable<(TransactionType Type, string Cur, decimal Amt)> src, TransactionType t, string cur) =>
            src.Where(x => x.Type == t && x.Cur == cur).Sum(x => x.Amt);

        // Only operating/debt flows are reported; opening balances and adjustments are not "activity".
        var flat = rows
            .Where(r => r.Type is TransactionType.Income or TransactionType.Expense or TransactionType.DebtBorrow
                or TransactionType.DebtLend or TransactionType.DebtRepayment or TransactionType.DebtCollection)
            .Select(r => (r.Type, Cur: r.Currency, Amt: r.Amount)).ToList();
        var totals = flat.Select(x => x.Cur).Distinct().OrderBy(c => c).Select(c =>
        {
            var income = Sum(flat, TransactionType.Income, c);
            var expense = Sum(flat, TransactionType.Expense, c);
            return new CurrencyTotals(c, income, expense, income - expense,
                Sum(flat, TransactionType.DebtBorrow, c), Sum(flat, TransactionType.DebtLend, c),
                Sum(flat, TransactionType.DebtRepayment, c), Sum(flat, TransactionType.DebtCollection, c));
        }).ToList();

        var debts = await db.Debts.AsNoTracking().Where(d => d.UserId == uid && d.Status == DebtStatus.Open)
            .GroupBy(d => new { d.Currency, d.Direction })
            .Select(g => new { g.Key.Currency, g.Key.Direction, Total = g.Sum(x => x.Outstanding) }).ToListAsync(ct);
        var debtPositions = debts.GroupBy(d => d.Currency).Select(g => new DebtPosition(g.Key,
            g.Where(x => x.Direction == DebtDirection.Borrowed).Sum(x => x.Total),
            g.Where(x => x.Direction == DebtDirection.Lent).Sum(x => x.Total))).OrderBy(d => d.Currency).ToList();

        var wallets = await (from w in db.Wallets.AsNoTracking()
                             join a in db.LedgerAccounts.AsNoTracking() on w.LedgerAccountId equals a.Id
                             where w.UserId == uid && !w.IsArchived
                             orderby w.SortOrder
                             select new WalletBalance(w.Id, w.Name, w.Currency, a.Balance)).ToListAsync(ct);

        var catNames = await db.Categories.AsNoTracking().Where(c => c.UserId == uid).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var top = rows.Where(r => r.Type == TransactionType.Expense).OrderByDescending(r => r.Amount).Take(5)
            .Select(r => new TopExpense(r.Id, r.OccurredAt, r.Amount, r.Currency,
                r.CategoryId is { } c && catNames.TryGetValue(c, out var n) ? n : null, r.Memo)).ToList();

        return new SummaryResult(totals, debtPositions, wallets, top);
    }

    public async Task<IReadOnlyList<SeriesPoint>> TimeSeriesAsync(Guid uid, TransactionQuery q, string granularity, CancellationToken ct)
    {
        var rows = await TransactionFilter.Apply(db, uid, q)
            .Where(e => e.Type == TransactionType.Income || e.Type == TransactionType.Expense)
            .Select(e => new { e.Type, e.Currency, e.Amount, e.OccurredAt }).ToListAsync(ct);

        return rows.GroupBy(r => (Start: BucketStart(r.OccurredAt, granularity), r.Currency))
            .OrderBy(g => g.Key.Start).ThenBy(g => g.Key.Currency)
            .Select(g => new SeriesPoint(Label(g.Key.Start, granularity), g.Key.Start, g.Key.Currency,
                g.Where(x => x.Type == TransactionType.Income).Sum(x => x.Amount),
                g.Where(x => x.Type == TransactionType.Expense).Sum(x => x.Amount))).ToList();
    }

    public async Task<IReadOnlyList<BreakdownRow>> BreakdownAsync(Guid uid, TransactionQuery q, string by, CancellationToken ct)
    {
        // Breakdown is about operating flow: expenses by default, income when asked via type=Income.
        var type = q.Type ?? TransactionType.Expense;
        var rows = await TransactionFilter.Apply(db, uid, q with { Type = type })
            .Select(e => new FlowRow(e.Currency, e.Amount, e.CategoryId, e.WalletId, e.ProjectId, e.PersonId, e.IncomeSourceId))
            .ToListAsync(ct);

        Func<FlowRow, Guid?> key = by switch
        {
            "wallet" => r => r.WalletId,
            "project" => r => r.ProjectId,
            "person" => r => r.PersonId,
            "source" => r => r.IncomeSourceId,
            _ => r => r.CategoryId,
        };
        var names = await ResolveNamesAsync(uid, by, ct);

        var result = new List<BreakdownRow>();
        foreach (var cur in rows.Select(r => r.Currency).Distinct().OrderBy(c => c))
        {
            var inCur = rows.Where(r => r.Currency == cur).ToList();
            var total = inCur.Sum(r => r.Amount);
            foreach (var g in inCur.GroupBy(r => (Guid?)key(r)).OrderByDescending(g => g.Sum(x => x.Amount)))
            {
                var sum = g.Sum(x => x.Amount);
                var name = g.Key is { } id && names.TryGetValue(id, out var n) ? n : "—";
                result.Add(new BreakdownRow(g.Key, name, cur, sum,
                    total == 0 ? 0 : Math.Round(sum / total * 100m, 2), g.Count()));
            }
        }
        return result;
    }

    public async Task<IReadOnlyList<BudgetStatus>> BudgetsAsync(Guid uid, DateTimeOffset now, CancellationToken ct)
    {
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var cats = await db.Categories.AsNoTracking()
            .Where(c => c.UserId == uid && !c.IsArchived && c.MonthlyLimit != null).ToListAsync(ct);
        var spent = await db.JournalEntries.AsNoTracking()
            .Where(e => e.UserId == uid && e.Type == TransactionType.Expense && e.ReversedById == null
                        && e.OccurredAt >= monthStart && e.CategoryId != null)
            .GroupBy(e => new { e.CategoryId, e.Currency })
            .Select(g => new { g.Key.CategoryId, g.Key.Currency, Total = g.Sum(x => x.Amount) }).ToListAsync(ct);

        return cats.Select(c =>
        {
            var cur = c.LimitCurrency ?? "UZS";
            var s = spent.Where(x => x.CategoryId == c.Id && x.Currency == cur).Sum(x => x.Total);
            var limit = c.MonthlyLimit!.Value;
            return new BudgetStatus(c.Id, c.Name, cur, limit, s, limit - s,
                limit == 0 ? 0 : Math.Round(s / limit * 100m, 1), s > limit);
        }).OrderByDescending(b => b.Percent).ToList();
    }

    private async Task<Dictionary<Guid, string>> ResolveNamesAsync(Guid uid, string by, CancellationToken ct) => by switch
    {
        "wallet" => await db.Wallets.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct),
        "project" => await db.Projects.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct),
        "person" => await db.People.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct),
        "source" => await db.IncomeSources.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct),
        _ => await db.Categories.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct),
    };

    internal static DateTimeOffset BucketStart(DateTimeOffset t, string granularity)
    {
        var u = t.UtcDateTime;
        return granularity switch
        {
            "year" => new DateTimeOffset(u.Year, 1, 1, 0, 0, 0, TimeSpan.Zero),
            "month" => new DateTimeOffset(u.Year, u.Month, 1, 0, 0, 0, TimeSpan.Zero),
            "week" => new DateTimeOffset(u.Date.AddDays(-(((int)u.DayOfWeek + 6) % 7)), TimeSpan.Zero), // Monday
            _ => new DateTimeOffset(u.Date, TimeSpan.Zero),
        };
    }

    private static string Label(DateTimeOffset start, string granularity) => granularity switch
    {
        "year" => start.ToString("yyyy", CultureInfo.InvariantCulture),
        "month" => start.ToString("yyyy-MM", CultureInfo.InvariantCulture),
        "week" => start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        _ => start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
    };
}
