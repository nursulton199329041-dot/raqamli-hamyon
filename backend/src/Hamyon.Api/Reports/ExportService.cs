using System.Globalization;
using System.IO.Compression;
using System.Security;
using System.Text;
using Hamyon.Api.Data;
using Hamyon.Api.Endpoints;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Reports;

public sealed record ExportRow(DateTimeOffset Date, string Type, string Wallet, string? ToWallet, decimal Amount,
    string Currency, decimal? ToAmount, string? ToCurrency, string? Category, string? Source, string? Person,
    string? Project, string? Memo, string Status);

public sealed record ExportCategoryRow(string Currency, string Category, string? SubCategory, decimal Total, decimal Percent, int Count);

public sealed class ExportTable
{
    public required string Title { get; init; }
    public required string Language { get; init; }
    public required IReadOnlyList<string> FilterLines { get; init; }
    /// <summary>(label, value) pairs of the filters that were applied, for the "Applied filters" sheet.</summary>
    public required IReadOnlyList<(string Key, string Value)> Filters { get; init; }
    public required IReadOnlyList<ExportRow> Rows { get; init; }
    public required IReadOnlyList<CurrencyTotals> Totals { get; init; }
    public required DateTimeOffset GeneratedAt { get; init; }
    public required IReadOnlyList<SeriesPoint> Series { get; init; }
    public required string PeriodLabel { get; init; }
    /// <summary>File name without extension, e.g. RaqamliHamyon_2026-10_Oylik.</summary>
    public required string FileStem { get; init; }
    /// <summary>Calendar days in the period (for daily averages).</summary>
    public required int Days { get; init; }
    public required IReadOnlyList<BalanceCurrency> Balances { get; init; }
    public required IReadOnlyList<ExportCategoryRow> Categories { get; init; }
    public required IReadOnlyList<BreakdownRow> Sources { get; init; }
    public required IReadOnlyList<WalletPeriod> Wallets { get; init; }
}

/// <summary>
/// Builds the report table once (same filters as the screen: <see cref="TransactionFilter"/>) and renders it as CSV, XLSX
/// or PDF. All figures come from the analytics service, so the file always agrees with the Reports screen.
/// </summary>
public sealed class ExportService(AppDbContext db, AnalyticsService analytics)
{
    private static readonly Dictionary<string, Dictionary<string, string>> L = new()
    {
        ["uz"] = new()
        {
            ["title"] = "Moliyaviy hisobot", ["period"] = "Davr", ["filters"] = "Filtrlar", ["totals"] = "Jami",
            ["date"] = "Sana", ["type"] = "Turi", ["wallet"] = "Hamyon", ["to_wallet"] = "Qabul qiluvchi hamyon",
            ["amount"] = "Summa", ["currency"] = "Valyuta", ["to_amount"] = "Qabul summasi", ["to_currency"] = "Qabul valyutasi",
            ["category"] = "Toifa", ["sub_category"] = "Podkategoriya", ["source"] = "Manba", ["person"] = "Shaxs", ["project"] = "Loyiha",
            ["memo"] = "Izoh", ["status"] = "Holat", ["income"] = "Kirim", ["expense"] = "Xarajat", ["net"] = "Sof oqim",
            ["borrowed"] = "Olingan qarz", ["lent"] = "Berilgan qarz", ["repaid"] = "Qaytarilgan", ["collected"] = "Undirilgan",
            ["active"] = "Faol", ["reversed"] = "Bekor qilingan", ["reversal"] = "Bekor qilish", ["sheet"] = "Operatsiyalar",
            ["sheet_totals"] = "Xulosa", ["sheet_categories"] = "Toifalar", ["sheet_wallets"] = "Hamyonlar", ["sheet_filters"] = "Filtrlar",
            ["generated"] = "Yaratilgan", ["none"] = "Filtr yo'q", ["chart"] = "Kirim va xarajat",
            ["opening"] = "Boshlang'ich balans", ["closing"] = "Yakuniy balans", ["change"] = "O'zgarish",
            ["avg_income"] = "O'rtacha kunlik kirim", ["avg_expense"] = "O'rtacha kunlik xarajat", ["top_category"] = "Eng katta xarajat toifasi",
            ["share"] = "Ulush", ["count"] = "Soni", ["archived"] = "Arxivda", ["yes"] = "ha", ["filter"] = "Filtr", ["value"] = "Qiymat",
            ["expense_by_category"] = "Xarajat toifalari bo'yicha", ["income_by_source"] = "Kirim manbalari bo'yicha",
            ["all_time"] = "Butun davr", ["f_month"] = "Oylik", ["f_year"] = "Yillik", ["f_all"] = "Hammasi", ["f_wallet"] = "Hamyon",
            ["f_project"] = "Loyiha", ["f_category"] = "Toifa", ["f_source"] = "Manba", ["days"] = "Kunlar",
            ["t0"] = "Boshlang'ich balans", ["t1"] = "Kirim", ["t2"] = "Xarajat", ["t3"] = "Transfer", ["t4"] = "Qarz olish",
            ["t5"] = "Qarz berish", ["t6"] = "Qarz qaytarish", ["t7"] = "Qarz undirish", ["t8"] = "Tuzatish", ["t9"] = "Bekor qilish",
        },
        ["en"] = new()
        {
            ["title"] = "Financial report", ["period"] = "Period", ["filters"] = "Filters", ["totals"] = "Totals",
            ["date"] = "Date", ["type"] = "Type", ["wallet"] = "Wallet", ["to_wallet"] = "Destination wallet",
            ["amount"] = "Amount", ["currency"] = "Currency", ["to_amount"] = "Received amount", ["to_currency"] = "Received currency",
            ["category"] = "Category", ["sub_category"] = "Sub-category", ["source"] = "Source", ["person"] = "Person", ["project"] = "Project",
            ["memo"] = "Note", ["status"] = "Status", ["income"] = "Income", ["expense"] = "Expense", ["net"] = "Net flow",
            ["borrowed"] = "Borrowed", ["lent"] = "Lent", ["repaid"] = "Repaid", ["collected"] = "Collected",
            ["active"] = "Active", ["reversed"] = "Reversed", ["reversal"] = "Reversal", ["sheet"] = "Transactions",
            ["sheet_totals"] = "Summary", ["sheet_categories"] = "Categories", ["sheet_wallets"] = "Wallets", ["sheet_filters"] = "Applied filters",
            ["generated"] = "Generated", ["none"] = "No filters", ["chart"] = "Income vs expense",
            ["opening"] = "Opening balance", ["closing"] = "Closing balance", ["change"] = "Change",
            ["avg_income"] = "Average daily income", ["avg_expense"] = "Average daily expense", ["top_category"] = "Largest expense category",
            ["share"] = "Share", ["count"] = "Count", ["archived"] = "Archived", ["yes"] = "yes", ["filter"] = "Filter", ["value"] = "Value",
            ["expense_by_category"] = "Expenses by category", ["income_by_source"] = "Income by source",
            ["all_time"] = "All time", ["f_month"] = "Monthly", ["f_year"] = "Yearly", ["f_all"] = "All", ["f_wallet"] = "Wallet",
            ["f_project"] = "Project", ["f_category"] = "Category", ["f_source"] = "Source", ["days"] = "Days",
            ["t0"] = "Opening balance", ["t1"] = "Income", ["t2"] = "Expense", ["t3"] = "Transfer", ["t4"] = "Borrowed",
            ["t5"] = "Lent", ["t6"] = "Debt repayment", ["t7"] = "Debt collection", ["t8"] = "Adjustment", ["t9"] = "Reversal",
        },
        ["ru"] = new()
        {
            ["title"] = "Финансовый отчёт", ["period"] = "Период", ["filters"] = "Фильтры", ["totals"] = "Итого",
            ["date"] = "Дата", ["type"] = "Тип", ["wallet"] = "Кошелёк", ["to_wallet"] = "Кошелёк получателя",
            ["amount"] = "Сумма", ["currency"] = "Валюта", ["to_amount"] = "Сумма получения", ["to_currency"] = "Валюта получения",
            ["category"] = "Категория", ["sub_category"] = "Подкатегория", ["source"] = "Источник", ["person"] = "Лицо", ["project"] = "Проект",
            ["memo"] = "Заметка", ["status"] = "Статус", ["income"] = "Доход", ["expense"] = "Расход", ["net"] = "Чистый поток",
            ["borrowed"] = "Взято в долг", ["lent"] = "Дано в долг", ["repaid"] = "Возвращено", ["collected"] = "Получено",
            ["active"] = "Активна", ["reversed"] = "Отменена", ["reversal"] = "Отмена", ["sheet"] = "Операции",
            ["sheet_totals"] = "Сводка", ["sheet_categories"] = "Категории", ["sheet_wallets"] = "Кошельки", ["sheet_filters"] = "Фильтры",
            ["generated"] = "Создано", ["none"] = "Без фильтров", ["chart"] = "Доходы и расходы",
            ["opening"] = "Начальный баланс", ["closing"] = "Конечный баланс", ["change"] = "Изменение",
            ["avg_income"] = "Средний доход в день", ["avg_expense"] = "Средний расход в день", ["top_category"] = "Крупнейшая категория расходов",
            ["share"] = "Доля", ["count"] = "Кол-во", ["archived"] = "В архиве", ["yes"] = "да", ["filter"] = "Фильтр", ["value"] = "Значение",
            ["expense_by_category"] = "Расходы по категориям", ["income_by_source"] = "Доходы по источникам",
            ["all_time"] = "Весь период", ["f_month"] = "Месяц", ["f_year"] = "Год", ["f_all"] = "Все", ["f_wallet"] = "Кошелёк",
            ["f_project"] = "Проект", ["f_category"] = "Категория", ["f_source"] = "Источник", ["days"] = "Дней",
            ["t0"] = "Начальный остаток", ["t1"] = "Доход", ["t2"] = "Расход", ["t3"] = "Перевод", ["t4"] = "Взят долг",
            ["t5"] = "Дан долг", ["t6"] = "Возврат долга", ["t7"] = "Получение долга", ["t8"] = "Корректировка", ["t9"] = "Отмена",
        },
    };

    public static string T(string lang, string key) =>
        (L.TryGetValue(lang, out var d) ? d : L["uz"]).TryGetValue(key, out var v) ? v : key;

    public async Task<ExportTable> BuildAsync(Guid uid, TransactionQuery q, string lang, string? granularity, CancellationToken ct)
    {
        lang = L.ContainsKey(lang) ? lang : "uz";
        var off = q.Offset;
        var entries = await TransactionFilter.Apply(db, uid, q with { IncludeReversed = q.IncludeReversed })
            .OrderBy(e => e.OccurredAt).ThenBy(e => e.CreatedAt).ToListAsync(ct);

        var wallets = await db.Wallets.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var catRows = await db.Categories.AsNoTracking().Where(x => x.UserId == uid).Select(x => new { x.Id, x.Name, x.ParentId }).ToListAsync(ct);
        var cats = catRows.ToDictionary(x => x.Id, x => x.Name);
        var parentOf = catRows.ToDictionary(x => x.Id, x => x.ParentId);
        var srcs = await db.IncomeSources.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var people = await db.People.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var projects = await db.Projects.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        static string? Name(Dictionary<Guid, string> d, Guid? id) => id is { } k && d.TryGetValue(k, out var n) ? n : null;
        string? CatPath(Guid? id) => id is { } k && cats.TryGetValue(k, out var n)
            ? parentOf.GetValueOrDefault(k) is { } p && cats.TryGetValue(p, out var pn) ? $"{pn} / {n}" : n : null;

        // Report dates are in the client's calendar (Tz), never raw UTC.
        var rows = entries.Select(e => new ExportRow(e.OccurredAt.ToOffset(off), T(lang, "t" + (int)e.Type),
            Name(wallets, e.WalletId) ?? "", Name(wallets, e.ToWalletId), e.Amount, e.Currency, e.ToAmount, e.ToCurrency,
            CatPath(e.CategoryId), Name(srcs, e.IncomeSourceId), Name(people, e.PersonId), Name(projects, e.ProjectId),
            e.Memo, e.ReversedById is not null ? T(lang, "reversed") : e.ReversalOfId is not null ? T(lang, "reversal") : T(lang, "active")))
            .ToList();

        var period = PeriodLabel(q.From, q.To, off);
        var filters = new List<(string, string)>();
        if (q.From is not null || q.To is not null) filters.Add((T(lang, "period"), period));
        if (q.WalletId is not null) filters.Add((T(lang, "wallet"), Name(wallets, q.WalletId) ?? "?"));
        if (q.CategoryId is not null) filters.Add((T(lang, "category"), CatPath(q.CategoryId) ?? "?"));
        if (q.SourceId is not null) filters.Add((T(lang, "source"), Name(srcs, q.SourceId) ?? "?"));
        if (q.PersonId is not null) filters.Add((T(lang, "person"), Name(people, q.PersonId) ?? "?"));
        if (q.ProjectId is not null) filters.Add((T(lang, "project"), Name(projects, q.ProjectId) ?? "?"));
        if (q.Type is not null) filters.Add((T(lang, "type"), T(lang, "t" + (int)q.Type)));
        if (!string.IsNullOrWhiteSpace(q.Currency)) filters.Add((T(lang, "currency"), q.Currency.Trim().ToUpperInvariant()));
        if (q.MinAmount is not null || q.MaxAmount is not null)
            filters.Add((T(lang, "amount"), $"{q.MinAmount?.ToString(CultureInfo.InvariantCulture) ?? "…"} – {q.MaxAmount?.ToString(CultureInfo.InvariantCulture) ?? "…"}"));
        if (!string.IsNullOrWhiteSpace(q.Q)) filters.Add(("?", q.Q));

        // Totals use the same exclusion rules as the dashboard (reversed pairs never counted).
        var live = q with { IncludeReversed = false };
        var summary = await analytics.SummaryAsync(uid, live, ct);
        var series = await analytics.TimeSeriesAsync(uid, live, "month", ct);
        var balance = await analytics.BalanceAsync(uid, live, "month", ct);
        var byCategory = await analytics.BreakdownAsync(uid, live with { Type = TransactionType.Expense }, "category", ct);
        var bySource = await analytics.BreakdownAsync(uid, live with { Type = TransactionType.Income }, "source", ct);
        var walletPeriods = await analytics.WalletPeriodsAsync(uid, live, ct);

        var categories = byCategory.Select(r =>
        {
            var parent = r.Id is { } id ? parentOf.GetValueOrDefault(id) : null;
            return parent is { } p && cats.TryGetValue(p, out var pn)
                ? new ExportCategoryRow(r.Currency, pn, r.Name, r.Total, r.Percent, r.Count)
                : new ExportCategoryRow(r.Currency, r.Name, null, r.Total, r.Percent, r.Count);
        }).ToList();

        var first = q.From ?? (entries.Count > 0 ? entries[0].OccurredAt : DateTimeOffset.UtcNow);
        var last = q.To ?? DateTimeOffset.UtcNow;
        var days = Math.Max(1, (int)Math.Round((last.ToOffset(off).Date.AddDays(1) - first.ToOffset(off).Date).TotalDays));

        return new ExportTable
        {
            Title = T(lang, "title"), Language = lang, Filters = filters,
            FilterLines = filters.Select(f => $"{f.Item1}: {f.Item2}").ToList(),
            Rows = rows, Totals = summary.Totals, GeneratedAt = DateTimeOffset.UtcNow.ToOffset(off), Series = series,
            PeriodLabel = q.From is null && q.To is null ? T(lang, "all_time") : period,
            FileStem = FileStem(q, off, lang), Days = days, Balances = balance.Currencies,
            Categories = categories, Sources = bySource, Wallets = walletPeriods,
        };
    }

    /// <summary>"2026-10-01 – 2026-10-27" in the client's calendar.</summary>
    private static string PeriodLabel(DateTimeOffset? from, DateTimeOffset? to, TimeSpan off) =>
        $"{from?.ToOffset(off).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "…"} – {to?.ToOffset(off).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "…"}";

    /// <summary>
    /// RaqamliHamyon_2026-10_Oylik, RaqamliHamyon_2026-10_Xarajat_UZS, RaqamliHamyon_2026-10-01_2026-10-27_Hamyon:
    /// the period (a whole calendar month / year is named as such) followed by the filters that narrow the report.
    /// </summary>
    internal static string FileStem(TransactionQuery q, TimeSpan off, string lang)
    {
        var parts = new List<string> { "RaqamliHamyon" };
        if (q.From is { } f && q.To is { } t)
        {
            var a = f.ToOffset(off);
            var b = t.ToOffset(off);
            var startOfDay = a.TimeOfDay == TimeSpan.Zero;
            var lastDay = new DateTime(a.Year, a.Month, DateTime.DaysInMonth(a.Year, a.Month));
            var wholeMonth = startOfDay && a.Day == 1 && b.Year == a.Year && b.Month == a.Month && b.Date == lastDay;
            var wholeYear = startOfDay && a.Month == 1 && a.Day == 1 && b.Year == a.Year && b.Month == 12 && b.Day == 31;
            if (wholeYear) parts.AddRange([a.ToString("yyyy", CultureInfo.InvariantCulture), T(lang, "f_year")]);
            else if (wholeMonth) parts.AddRange([a.ToString("yyyy-MM", CultureInfo.InvariantCulture), T(lang, "f_month")]);
            else parts.AddRange([a.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), b.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)]);
        }
        else if (q.From is { } only) parts.Add(only.ToOffset(off).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        else parts.Add(T(lang, "f_all"));

        if (q.Type == TransactionType.Income) parts.Add(T(lang, "income"));
        if (q.Type == TransactionType.Expense) parts.Add(T(lang, "expense"));
        if (!string.IsNullOrWhiteSpace(q.Currency)) parts.Add(q.Currency.Trim().ToUpperInvariant());
        if (q.WalletId is not null) parts.Add(T(lang, "f_wallet"));
        if (q.CategoryId is not null) parts.Add(T(lang, "f_category"));
        if (q.SourceId is not null) parts.Add(T(lang, "f_source"));
        if (q.ProjectId is not null) parts.Add(T(lang, "f_project"));
        // letters (any script), digits and dashes only: safe on every file system and share target
        var clean = parts.Select(p => new string(p.Where(ch => char.IsLetterOrDigit(ch) || ch == '-').ToArray())).Where(p => p.Length > 0);
        return string.Join('_', clean);
    }

    // ------------------------------------------------------------------ CSV

    public static byte[] ToCsv(ExportTable t)
    {
        var lang = t.Language;
        var sb = new StringBuilder();
        sb.AppendJoin(',', new[] { "date", "type", "wallet", "to_wallet", "amount", "currency", "to_amount", "to_currency",
            "category", "source", "person", "project", "memo", "status" }.Select(k => Csv(T(lang, k)))).Append("\r\n");
        foreach (var r in t.Rows)
        {
            sb.AppendJoin(',', new[]
            {
                Csv(r.Date.DateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)), Csv(r.Type), Csv(r.Wallet),
                Csv(r.ToWallet), r.Amount.ToString("0.00##", CultureInfo.InvariantCulture), r.Currency,
                r.ToAmount?.ToString("0.00##", CultureInfo.InvariantCulture) ?? "", r.ToCurrency ?? "",
                Csv(r.Category), Csv(r.Source), Csv(r.Person), Csv(r.Project), Csv(r.Memo), Csv(r.Status),
            }).Append("\r\n");
        }
        return new UTF8Encoding(true).GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
    }

    private static string Csv(string? v)
    {
        if (string.IsNullOrEmpty(v)) return "";
        // Neutralize spreadsheet formula injection.
        if (v[0] is '=' or '+' or '-' or '@' or '\t' or '\r') v = "'" + v;
        return v.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
    }

    // ------------------------------------------------------------------ XLSX

    // cell styles (index into cellXfs)
    private const int SHeader = 1, SMoney = 2, SDate = 3, SPercent = 4, STitle = 5;

    /// <summary>
    /// Workbook (sheets in this order): Summary, Transactions, Categories, Wallets, Applied filters.
    /// Part files keep stable names (sheet1 = transactions, sheet2 = summary) because the summary's SUMIFS formulas
    /// reference the transactions sheet. Headers are frozen, columns sized, money uses #,##0.00.
    /// Currencies are never summed together: every figure is per currency.
    /// </summary>
    public static byte[] ToXlsx(ExportTable t)
    {
        var lang = t.Language;
        var sn = SheetName(T(lang, "sheet"));

        // ---- sheet1: transactions
        var tx = new Sheet([19, 20, 20, 20, 18, 10, 18, 10, 26, 20, 20, 20, 36, 14], freezeRows: 1);
        var headers = new[] { "date", "type", "wallet", "to_wallet", "amount", "currency", "to_amount", "to_currency",
            "category", "source", "person", "project", "memo", "status" };
        tx.Row(headers.Select(h => Cell.Str(T(lang, h), SHeader)).ToArray());
        foreach (var row in t.Rows)
        {
            tx.Row(Cell.Date(row.Date), Cell.Str(row.Type), Cell.Str(row.Wallet), Cell.Str(row.ToWallet), Cell.Num(row.Amount),
                Cell.Str(row.Currency), row.ToAmount is { } ta ? Cell.Num(ta) : Cell.Empty, Cell.Str(row.ToCurrency),
                Cell.Str(row.Category), Cell.Str(row.Source), Cell.Str(row.Person), Cell.Str(row.Project), Cell.Str(row.Memo),
                Cell.Str(row.Status));
        }
        var lastRow = Math.Max(2, t.Rows.Count + 1);

        // ---- sheet2: summary
        var sum = new Sheet([16, 18, 18, 18, 20, 20, 22, 22, 32], freezeRows: 5);
        sum.Row(Cell.Str(t.Title, STitle));
        sum.Row(Cell.Str(T(lang, "period")), Cell.Str(t.PeriodLabel), Cell.Str(T(lang, "days")), Cell.Int(t.Days));
        sum.Row(Cell.Str(T(lang, "generated")), Cell.Str(t.GeneratedAt.DateTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)));
        sum.Row();
        sum.Row(new[] { "currency", "income", "expense", "net", "opening", "closing", "avg_income", "avg_expense", "top_category" }
            .Select(k => Cell.Str(T(lang, k), SHeader)).ToArray());
        var q = $"'{sn.Replace("'", "''")}'";
        var active = T(lang, "active").Replace("\"", "\"\"");
        var currencies = t.Totals.Select(x => x.Currency).Union(t.Balances.Select(b => b.Currency)).Distinct().OrderBy(c => c);
        foreach (var cur in currencies)
        {
            var tot = t.Totals.FirstOrDefault(x => x.Currency == cur);
            var bal = t.Balances.FirstOrDefault(x => x.Currency == cur);
            var r = sum.NextRow;
            string Sumifs(string typeLabel) =>
                $"SUMIFS({q}!$E$2:$E${lastRow},{q}!$B$2:$B${lastRow},\"{typeLabel.Replace("\"", "\"\"")}\",{q}!$F$2:$F${lastRow},$A{r},{q}!$N$2:$N${lastRow},\"{active}\")";
            var top = t.Categories.Where(c => c.Currency == cur).OrderByDescending(c => c.Total).FirstOrDefault();
            sum.Row(Cell.Str(cur),
                Cell.Formula(Sumifs(T(lang, "t1")), tot?.Income ?? 0), Cell.Formula(Sumifs(T(lang, "t2")), tot?.Expense ?? 0),
                Cell.Formula($"B{r}-C{r}", tot?.NetFlow ?? 0),
                bal is null ? Cell.Empty : Cell.Num(bal.Opening), bal is null ? Cell.Empty : Cell.Num(bal.Closing),
                Cell.Formula($"B{r}/$D$2", (tot?.Income ?? 0) / t.Days), Cell.Formula($"C{r}/$D$2", (tot?.Expense ?? 0) / t.Days),
                Cell.Str(top is null ? null : top.SubCategory is null ? top.Category : $"{top.Category} / {top.SubCategory}"));
        }

        // ---- sheet3: categories (expense by category / sub-category, then income by source)
        var cat = new Sheet([12, 28, 28, 18, 12, 10], freezeRows: 2);
        cat.Row(Cell.Str(T(lang, "expense_by_category"), STitle));
        cat.Row(new[] { "currency", "category", "sub_category", "amount", "share", "count" }.Select(k => Cell.Str(T(lang, k), SHeader)).ToArray());
        foreach (var c in t.Categories)
            cat.Row(Cell.Str(c.Currency), Cell.Str(c.Category), Cell.Str(c.SubCategory), Cell.Num(c.Total), Cell.Pct(c.Percent), Cell.Int(c.Count));
        cat.Row();
        cat.Row(Cell.Str(T(lang, "income_by_source"), STitle));
        cat.Row(Cell.Str(T(lang, "currency"), SHeader), Cell.Str(T(lang, "source"), SHeader), Cell.Str(null, SHeader),
            Cell.Str(T(lang, "amount"), SHeader), Cell.Str(T(lang, "share"), SHeader), Cell.Str(T(lang, "count"), SHeader));
        foreach (var s in t.Sources)
            cat.Row(Cell.Str(s.Currency), Cell.Str(s.Name), Cell.Empty, Cell.Num(s.Total), Cell.Pct(s.Percent), Cell.Int(s.Count));

        // ---- sheet4: wallets (balance at the start and end of the period, from ledger lines)
        var wal = new Sheet([28, 10, 20, 20, 20, 10], freezeRows: 1);
        wal.Row(new[] { "wallet", "currency", "opening", "closing", "change", "archived" }.Select(k => Cell.Str(T(lang, k), SHeader)).ToArray());
        foreach (var w in t.Wallets)
        {
            var r = wal.NextRow;
            wal.Row(Cell.Str(w.Name), Cell.Str(w.Currency), Cell.Num(w.Opening), Cell.Num(w.Closing),
                Cell.Formula($"D{r}-C{r}", w.Closing - w.Opening), Cell.Str(w.IsArchived ? T(lang, "yes") : null));
        }

        // ---- sheet5: applied filters
        var fil = new Sheet([24, 50], freezeRows: 1);
        fil.Row(Cell.Str(T(lang, "filter"), SHeader), Cell.Str(T(lang, "value"), SHeader));
        if (t.Filters.Count == 0) fil.Row(Cell.Str(T(lang, "none")));
        foreach (var (k, v) in t.Filters) fil.Row(Cell.Str(k), Cell.Str(v));

        // workbook order -> part file
        var sheets = new (string Name, string Part, Sheet Sheet)[]
        {
            (SheetName(T(lang, "sheet_totals")), "sheet2", sum), (sn, "sheet1", tx), (SheetName(T(lang, "sheet_categories")), "sheet3", cat),
            (SheetName(T(lang, "sheet_wallets")), "sheet4", wal), (SheetName(T(lang, "sheet_filters")), "sheet5", fil),
        };

        const string ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var workbook = new StringBuilder($"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"{ns}\" " +
                                         "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
        for (var i = 0; i < sheets.Length; i++)
            workbook.Append($"<sheet name=\"{SecurityElement.Escape(sheets[i].Name)}\" sheetId=\"{i + 1}\" r:id=\"rId{i + 1}\"/>");
        workbook.Append("</sheets><calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/></workbook>");

        const string styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
            "<numFmts count=\"3\"><numFmt numFmtId=\"164\" formatCode=\"#,##0.00\"/><numFmt numFmtId=\"165\" formatCode=\"yyyy\\-mm\\-dd\\ hh:mm\"/>" +
            "<numFmt numFmtId=\"166\" formatCode=\"0.00&quot;%&quot;\"/></numFmts>" +
            "<fonts count=\"3\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
            "<font><b/><sz val=\"14\"/><name val=\"Calibri\"/></font></fonts>" +
            "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>" +
            "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFDDE7F5\"/></patternFill></fill></fills>" +
            "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
            "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
            "<cellXfs count=\"6\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
            "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>" +
            "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>" +
            "<xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>" +
            "<xf numFmtId=\"166\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>" +
            "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs></styleSheet>";

        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            var types = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
            var rels = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            for (var i = 0; i < sheets.Length; i++)
            {
                types.Append($"<Override PartName=\"/xl/worksheets/{sheets[i].Part}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                rels.Append($"<Relationship Id=\"rId{i + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/{sheets[i].Part}.xml\"/>");
            }
            rels.Append($"<Relationship Id=\"rId{sheets.Length + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
            types.Append("</Types>");

            Add(zip, "[Content_Types].xml", types.ToString());
            Add(zip, "_rels/.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml", workbook.ToString());
            Add(zip, "xl/_rels/workbook.xml.rels", rels.ToString());
            Add(zip, "xl/styles.xml", styles);
            foreach (var s in sheets) Add(zip, $"xl/worksheets/{s.Part}.xml", s.Sheet.ToXml());
        }
        return ms.ToArray();
    }

    /// <summary>Excel sheet names: at most 31 characters, none of : \ / ? * [ ].</summary>
    private static string SheetName(string s)
    {
        var n = new string(s.Where(ch => ":\\/?*[]".IndexOf(ch) < 0).ToArray());
        return n.Length > 31 ? n[..31] : n;
    }

    private static void Add(ZipArchive zip, string name, string content)
    {
        var e = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var w = new StreamWriter(e.Open(), new UTF8Encoding(false));
        w.Write(content);
    }

    /// <summary>One worksheet: column widths, frozen header rows and cells written in order.</summary>
    private sealed class Sheet(int[] widths, int freezeRows)
    {
        private readonly StringBuilder _rows = new();
        public int NextRow { get; private set; } = 1;

        public void Row(params Cell[] cells)
        {
            var r = NextRow++;
            _rows.Append($"<row r=\"{r}\">");
            for (var c = 0; c < cells.Length; c++) _rows.Append(cells[c].Xml(ColName(c) + r));
            _rows.Append("</row>");
        }

        public string ToXml()
        {
            var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
            if (freezeRows > 0)
                sb.Append($"<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"{freezeRows}\" topLeftCell=\"A{freezeRows + 1}\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>");
            sb.Append("<cols>");
            for (var i = 0; i < widths.Length; i++) sb.Append($"<col min=\"{i + 1}\" max=\"{i + 1}\" width=\"{widths[i]}\" customWidth=\"1\"/>");
            sb.Append("</cols><sheetData>").Append(_rows).Append("</sheetData></worksheet>");
            return sb.ToString();
        }
    }

    private readonly record struct Cell(char Kind, string? Text, decimal Value, int Style, string? Expr)
    {
        public static readonly Cell Empty = new('e', null, 0, 0, null);
        public static Cell Str(string? s, int style = 0) => new('s', s, 0, style, null);
        public static Cell Num(decimal v) => new('n', null, v, SMoney, null);
        public static Cell Int(int v) => new('n', null, v, 0, null);
        public static Cell Pct(decimal v) => new('n', null, v, SPercent, null);
        public static Cell Date(DateTimeOffset d) => new('n', null, ExcelDate(d), SDate, null);
        public static Cell Formula(string f, decimal cached) => new('f', null, cached, SMoney, f);

        public string Xml(string at)
        {
            var s = Style > 0 ? $" s=\"{Style}\"" : "";
            return Kind switch
            {
                // inline strings: user text can never become a formula; an empty styled cell keeps the header fill
                's' when !string.IsNullOrEmpty(Text) =>
                    $"<c r=\"{at}\" t=\"inlineStr\"{s}><is><t xml:space=\"preserve\">{SecurityElement.Escape(StripInvalidXml(Text))}</t></is></c>",
                's' when Style > 0 => $"<c r=\"{at}\"{s}/>",
                'n' => $"<c r=\"{at}\"{s}><v>{Value.ToString("0.####", CultureInfo.InvariantCulture)}</v></c>",
                'f' => $"<c r=\"{at}\"{s}><f>{SecurityElement.Escape(Expr)}</f><v>{Math.Round(Value, 4).ToString("0.####", CultureInfo.InvariantCulture)}</v></c>",
                _ => "",
            };
        }
    }

    private static string StripInvalidXml(string s) =>
        new(s.Where(ch => ch is '\t' or '\n' or '\r' || (ch >= 0x20 && ch != '￾' && ch != '￿')).ToArray());

    private static string ColName(int zeroBased)
    {
        var n = zeroBased + 1;
        var s = "";
        while (n > 0) { n--; s = (char)('A' + n % 26) + s; n /= 26; }
        return s;
    }

    /// <summary>Excel serial date of the wall-clock time in the row's offset (the client's calendar).</summary>
    private static decimal ExcelDate(DateTimeOffset d) =>
        (decimal)(d.DateTime - new DateTime(1899, 12, 30, 0, 0, 0)).TotalDays;
}
