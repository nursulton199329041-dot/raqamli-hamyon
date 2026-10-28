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

public sealed record BalancePoint(string Period, DateTimeOffset Start, decimal Balance);

public sealed record BalanceCurrency(string Currency, decimal Opening, decimal Closing, IReadOnlyList<BalancePoint> Points);

public sealed record BalanceHistory(string Granularity, DateTimeOffset From, DateTimeOffset To, IReadOnlyList<BalanceCurrency> Currencies);

public sealed record WalletPeriod(Guid WalletId, string Name, string Currency, bool IsArchived, decimal Opening, decimal Closing);

public sealed record BudgetStatus(Guid CategoryId, string Name, string Currency, decimal Limit, decimal Spent,
    decimal Remaining, decimal Percent, bool Exceeded);

/// <summary>
/// Read-side analytics built from immutable journal summaries. Different currencies are always reported
/// side by side – never summed together. Debts/transfers/openings never leak into income or expense.
/// </summary>
public sealed class AnalyticsService(AppDbContext db)
{
    // An expense paid from a wallet in another currency counts in the currency it was spent in (ToCurrency/ToAmount);
    // every other flow, and every same-currency expense, keeps the wallet side.
    private static string ExpCur(JournalEntry e) => e.Type == TransactionType.Expense && e.ToCurrency != null ? e.ToCurrency : e.Currency;
    private static decimal ExpAmt(JournalEntry e) => e.Type == TransactionType.Expense && e.ToAmount != null ? e.ToAmount.Value : e.Amount;

    public async Task<SummaryResult> SummaryAsync(Guid uid, TransactionQuery q, CancellationToken ct)
    {
        var rows = await TransactionFilter.Apply(db, uid, q).Select(e => new
        {
            e.Id, e.Type, Currency = ExpCur(e), Amount = ExpAmt(e), e.OccurredAt, e.CategoryId, e.Memo,
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

    /// <summary>
    /// Income/expense per period and currency. Buckets follow the client's calendar (<see cref="TransactionQuery.Tz"/>).
    /// When both From and To are given, empty periods are returned as explicit zeros so charts show real gaps.
    /// </summary>
    public async Task<IReadOnlyList<SeriesPoint>> TimeSeriesAsync(Guid uid, TransactionQuery q, string granularity, CancellationToken ct)
    {
        var off = q.Offset;
        var rows = await TransactionFilter.Apply(db, uid, q)
            .Where(e => e.Type == TransactionType.Income || e.Type == TransactionType.Expense)
            .Select(e => new { e.Type, Currency = ExpCur(e), Amount = ExpAmt(e), e.OccurredAt }).ToListAsync(ct);

        var grouped = rows.GroupBy(r => (Start: BucketStart(r.OccurredAt, granularity, off), r.Currency))
            .ToDictionary(g => g.Key, g => (
                Income: g.Where(x => x.Type == TransactionType.Income).Sum(x => x.Amount),
                Expense: g.Where(x => x.Type == TransactionType.Expense).Sum(x => x.Amount)));

        IEnumerable<(DateTimeOffset Start, string Currency)> keys = grouped.Keys;
        if (q.From is { } from && q.To is { } to && grouped.Count > 0)
        {
            var buckets = Buckets(from, to, granularity, off);
            if (buckets.Count <= MaxBuckets)
                keys = grouped.Keys.Select(k => k.Currency).Distinct().SelectMany(c => buckets.Select(b => (b, c)));
        }

        return keys.OrderBy(k => k.Start).ThenBy(k => k.Currency).Select(k =>
        {
            var v = grouped.TryGetValue(k, out var x) ? x : (0m, 0m);
            return new SeriesPoint(Label(k.Start, granularity, off), k.Start.ToOffset(off), k.Currency, v.Item1, v.Item2);
        }).ToList();
    }

    /// <summary>
    /// Wallet balance history straight from ledger lines (the source of truth): the balance at the start of the period,
    /// at the end of every bucket and at the end of the period, per currency. Currencies are never added together.
    /// Reversed operations need no special care: an operation and its reversal both post lines and cancel out.
    /// Filters honoured: wallet, currency, project (bucket lines). Other filters do not apply to a balance.
    /// </summary>
    public async Task<BalanceHistory> BalanceAsync(Guid uid, TransactionQuery q, string granularity, CancellationToken ct)
    {
        var off = q.Offset;
        var wallets = db.Wallets.AsNoTracking().Where(w => w.UserId == uid);
        if (q.WalletId is { } wid) wallets = wallets.Where(w => w.Id == wid);
        if (!string.IsNullOrWhiteSpace(q.Currency)) wallets = wallets.Where(w => w.Currency == q.Currency.Trim().ToUpperInvariant());
        var accounts = wallets.Select(w => w.LedgerAccountId);

        var lines = from l in db.LedgerLines.AsNoTracking()
                    join e in db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
                    where l.UserId == uid && accounts.Contains(l.LedgerAccountId)
                    select new { l.Amount, l.Currency, l.ProjectId, e.OccurredAt };
        if (q.ProjectId is { } pid) lines = lines.Where(l => l.ProjectId == pid);
        var all = await lines.Select(l => new { l.Amount, l.Currency, l.OccurredAt }).ToListAsync(ct);

        var to = q.To ?? DateTimeOffset.UtcNow;
        var from = q.From ?? (all.Count > 0 ? all.Min(l => l.OccurredAt) : to.AddDays(-30));
        if (from > to) (from, to) = (to, from);

        var buckets = Buckets(from, to, granularity, off);
        foreach (var coarser in new[] { "week", "month", "year" })
        {
            if (buckets.Count <= MaxBuckets) break;
            granularity = coarser;
            buckets = Buckets(from, to, granularity, off);
        }

        var result = new List<BalanceCurrency>();
        foreach (var cur in all.Select(l => l.Currency).Distinct().OrderBy(c => c))
        {
            var mine = all.Where(l => l.Currency == cur).OrderBy(l => l.OccurredAt).ToList();
            var opening = mine.Where(l => l.OccurredAt < from).Sum(l => l.Amount);
            var points = new List<BalancePoint>(buckets.Count);
            var running = opening;
            var i = mine.FindIndex(l => l.OccurredAt >= from);
            if (i < 0) i = mine.Count;
            for (var b = 0; b < buckets.Count; b++)
            {
                var end = b + 1 < buckets.Count ? buckets[b + 1] : to.AddTicks(1);
                while (i < mine.Count && mine[i].OccurredAt < end && mine[i].OccurredAt <= to) running += mine[i++].Amount;
                points.Add(new BalancePoint(Label(buckets[b], granularity, off), buckets[b].ToOffset(off), running));
            }
            var closing = opening + mine.Where(l => l.OccurredAt >= from && l.OccurredAt <= to).Sum(l => l.Amount);
            result.Add(new BalanceCurrency(cur, opening, closing, points));
        }
        return new BalanceHistory(granularity, from, to, result);
    }

    /// <summary>Per-wallet balance at the start and end of the period (ledger lines), for reports and exports.</summary>
    public async Task<IReadOnlyList<WalletPeriod>> WalletPeriodsAsync(Guid uid, TransactionQuery q, CancellationToken ct)
    {
        var wallets = db.Wallets.AsNoTracking().Where(w => w.UserId == uid);
        if (q.WalletId is { } wid) wallets = wallets.Where(w => w.Id == wid);
        if (!string.IsNullOrWhiteSpace(q.Currency)) wallets = wallets.Where(w => w.Currency == q.Currency.Trim().ToUpperInvariant());
        var list = await wallets.OrderBy(w => w.SortOrder).Select(w => new { w.Id, w.Name, w.Currency, w.LedgerAccountId, w.IsArchived }).ToListAsync(ct);
        var ids = list.Select(w => w.LedgerAccountId).ToList();
        var to = (q.To ?? DateTimeOffset.UtcNow).ToUniversalTime();
        var lines = await (from l in db.LedgerLines.AsNoTracking()
                           join e in db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
                           where l.UserId == uid && ids.Contains(l.LedgerAccountId) && e.OccurredAt <= to
                           select new { l.LedgerAccountId, l.Amount, e.OccurredAt }).ToListAsync(ct);
        return list.Select(w =>
        {
            var mine = lines.Where(l => l.LedgerAccountId == w.LedgerAccountId).ToList();
            var opening = q.From is { } f ? mine.Where(l => l.OccurredAt < f).Sum(l => l.Amount) : 0m;
            var closing = mine.Sum(l => l.Amount);
            return new WalletPeriod(w.Id, w.Name, w.Currency, w.IsArchived, opening, closing);
        }).Where(w => !w.IsArchived || w.Opening != 0 || w.Closing != 0).ToList();
    }

    /// <summary>A day series over years would be thousands of points; callers fall back to coarser buckets above this.</summary>
    internal const int MaxBuckets = 400;

    internal static List<DateTimeOffset> Buckets(DateTimeOffset from, DateTimeOffset to, string granularity, TimeSpan off)
    {
        var list = new List<DateTimeOffset>();
        var b = BucketStart(from, granularity, off);
        var last = BucketStart(to, granularity, off);
        while (b <= last && list.Count <= MaxBuckets + 1)
        {
            list.Add(b);
            var local = b.ToOffset(off);
            b = (granularity switch
            {
                "year" => local.AddYears(1),
                "month" => local.AddMonths(1),
                "week" => local.AddDays(7),
                _ => local.AddDays(1),
            }).ToUniversalTime();
        }
        return list;
    }

    public async Task<IReadOnlyList<BreakdownRow>> BreakdownAsync(Guid uid, TransactionQuery q, string by, CancellationToken ct)
    {
        // Breakdown is about operating flow: expenses by default, income when asked via type=Income.
        var type = q.Type ?? TransactionType.Expense;
        var rows = await TransactionFilter.Apply(db, uid, q with { Type = type })
            .Select(e => new FlowRow(ExpCur(e), ExpAmt(e), e.CategoryId, e.WalletId, e.ProjectId, e.PersonId, e.IncomeSourceId))
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
            .Select(e => new { e.CategoryId, Currency = e.ToCurrency ?? e.Currency, Amount = e.ToAmount ?? e.Amount })
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

    /// <summary>Start of the bucket containing <paramref name="t"/> in the client's calendar (offset <paramref name="off"/>), as UTC.</summary>
    internal static DateTimeOffset BucketStart(DateTimeOffset t, string granularity, TimeSpan off = default)
    {
        var u = t.ToOffset(off).DateTime;
        var local = granularity switch
        {
            "year" => new DateTime(u.Year, 1, 1),
            "month" => new DateTime(u.Year, u.Month, 1),
            "week" => u.Date.AddDays(-(((int)u.DayOfWeek + 6) % 7)), // Monday
            _ => u.Date,
        };
        return new DateTimeOffset(local, off).ToUniversalTime();
    }

    /// <summary>Label in the client's calendar: 2026, 2026-10, 2026-10-27.</summary>
    private static string Label(DateTimeOffset start, string granularity, TimeSpan off)
    {
        var l = start.ToOffset(off);
        return granularity switch
        {
            "year" => l.ToString("yyyy", CultureInfo.InvariantCulture),
            "month" => l.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            _ => l.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        };
    }
}
