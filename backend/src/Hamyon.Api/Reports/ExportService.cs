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

public sealed class ExportTable
{
    public required string Title { get; init; }
    public required string Language { get; init; }
    public required IReadOnlyList<string> FilterLines { get; init; }
    public required IReadOnlyList<ExportRow> Rows { get; init; }
    public required IReadOnlyList<CurrencyTotals> Totals { get; init; }
    public required DateTimeOffset GeneratedAt { get; init; }
    public required IReadOnlyList<SeriesPoint> Series { get; init; }
}

public sealed class ExportService(AppDbContext db, AnalyticsService analytics)
{
    private static readonly Dictionary<string, Dictionary<string, string>> L = new()
    {
        ["uz"] = new()
        {
            ["title"] = "Moliyaviy hisobot", ["period"] = "Davr", ["filters"] = "Filtrlar", ["totals"] = "Jami",
            ["date"] = "Sana", ["type"] = "Turi", ["wallet"] = "Hamyon", ["to_wallet"] = "Qabul qiluvchi hamyon",
            ["amount"] = "Summa", ["currency"] = "Valyuta", ["to_amount"] = "Qabul summasi", ["to_currency"] = "Qabul valyutasi",
            ["category"] = "Toifa", ["source"] = "Manba", ["person"] = "Shaxs", ["project"] = "Loyiha", ["memo"] = "Izoh",
            ["status"] = "Holat", ["income"] = "Kirim", ["expense"] = "Chiqim", ["net"] = "Sof oqim",
            ["borrowed"] = "Olingan qarz", ["lent"] = "Berilgan qarz", ["repaid"] = "Qaytarilgan", ["collected"] = "Undirilgan",
            ["active"] = "Faol", ["reversed"] = "Bekor qilingan", ["reversal"] = "Bekor qilish", ["sheet"] = "Operatsiyalar",
            ["sheet_totals"] = "Jami", ["generated"] = "Yaratilgan", ["none"] = "Filtr yo'q", ["chart"] = "Kirim va chiqim",
            ["t0"] = "Boshlang'ich balans", ["t1"] = "Kirim", ["t2"] = "Xarajat", ["t3"] = "Transfer", ["t4"] = "Qarz olish",
            ["t5"] = "Qarz berish", ["t6"] = "Qarz qaytarish", ["t7"] = "Qarz undirish", ["t8"] = "Tuzatish", ["t9"] = "Bekor qilish",
        },
        ["en"] = new()
        {
            ["title"] = "Financial report", ["period"] = "Period", ["filters"] = "Filters", ["totals"] = "Totals",
            ["date"] = "Date", ["type"] = "Type", ["wallet"] = "Wallet", ["to_wallet"] = "Destination wallet",
            ["amount"] = "Amount", ["currency"] = "Currency", ["to_amount"] = "Received amount", ["to_currency"] = "Received currency",
            ["category"] = "Category", ["source"] = "Source", ["person"] = "Person", ["project"] = "Project", ["memo"] = "Note",
            ["status"] = "Status", ["income"] = "Income", ["expense"] = "Expense", ["net"] = "Net flow",
            ["borrowed"] = "Borrowed", ["lent"] = "Lent", ["repaid"] = "Repaid", ["collected"] = "Collected",
            ["active"] = "Active", ["reversed"] = "Reversed", ["reversal"] = "Reversal", ["sheet"] = "Transactions",
            ["sheet_totals"] = "Totals", ["generated"] = "Generated", ["none"] = "No filters", ["chart"] = "Income vs expense",
            ["t0"] = "Opening balance", ["t1"] = "Income", ["t2"] = "Expense", ["t3"] = "Transfer", ["t4"] = "Borrowed",
            ["t5"] = "Lent", ["t6"] = "Debt repayment", ["t7"] = "Debt collection", ["t8"] = "Adjustment", ["t9"] = "Reversal",
        },
        ["ru"] = new()
        {
            ["title"] = "Финансовый отчёт", ["period"] = "Период", ["filters"] = "Фильтры", ["totals"] = "Итого",
            ["date"] = "Дата", ["type"] = "Тип", ["wallet"] = "Кошелёк", ["to_wallet"] = "Кошелёк получателя",
            ["amount"] = "Сумма", ["currency"] = "Валюта", ["to_amount"] = "Сумма получения", ["to_currency"] = "Валюта получения",
            ["category"] = "Категория", ["source"] = "Источник", ["person"] = "Лицо", ["project"] = "Проект", ["memo"] = "Заметка",
            ["status"] = "Статус", ["income"] = "Доход", ["expense"] = "Расход", ["net"] = "Чистый поток",
            ["borrowed"] = "Взято в долг", ["lent"] = "Дано в долг", ["repaid"] = "Возвращено", ["collected"] = "Получено",
            ["active"] = "Активна", ["reversed"] = "Отменена", ["reversal"] = "Отмена", ["sheet"] = "Операции",
            ["sheet_totals"] = "Итого", ["generated"] = "Создано", ["none"] = "Без фильтров", ["chart"] = "Доходы и расходы",
            ["t0"] = "Начальный остаток", ["t1"] = "Доход", ["t2"] = "Расход", ["t3"] = "Перевод", ["t4"] = "Взят долг",
            ["t5"] = "Дан долг", ["t6"] = "Возврат долга", ["t7"] = "Получение долга", ["t8"] = "Корректировка", ["t9"] = "Отмена",
        },
    };

    public static string T(string lang, string key) =>
        (L.TryGetValue(lang, out var d) ? d : L["uz"]).TryGetValue(key, out var v) ? v : key;

    public async Task<ExportTable> BuildAsync(Guid uid, TransactionQuery q, string lang, CancellationToken ct)
    {
        lang = L.ContainsKey(lang) ? lang : "uz";
        var entries = await TransactionFilter.Apply(db, uid, q with { IncludeReversed = q.IncludeReversed })
            .OrderBy(e => e.OccurredAt).ThenBy(e => e.CreatedAt).ToListAsync(ct);

        var wallets = await db.Wallets.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var cats = await db.Categories.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var srcs = await db.IncomeSources.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var people = await db.People.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var projects = await db.Projects.AsNoTracking().Where(x => x.UserId == uid).ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        static string? Name(Dictionary<Guid, string> d, Guid? id) => id is { } k && d.TryGetValue(k, out var n) ? n : null;

        var rows = entries.Select(e => new ExportRow(e.OccurredAt, T(lang, "t" + (int)e.Type),
            Name(wallets, e.WalletId) ?? "", Name(wallets, e.ToWalletId), e.Amount, e.Currency, e.ToAmount, e.ToCurrency,
            Name(cats, e.CategoryId), Name(srcs, e.IncomeSourceId), Name(people, e.PersonId), Name(projects, e.ProjectId),
            e.Memo, e.ReversedById is not null ? T(lang, "reversed") : e.ReversalOfId is not null ? T(lang, "reversal") : T(lang, "active")))
            .ToList();

        var filters = new List<string>();
        if (q.From is not null || q.To is not null)
            filters.Add($"{T(lang, "period")}: {q.From?.ToString("yyyy-MM-dd") ?? "…"} – {q.To?.ToString("yyyy-MM-dd") ?? "…"}");
        if (q.WalletId is not null) filters.Add($"{T(lang, "wallet")}: {Name(wallets, q.WalletId)}");
        if (q.CategoryId is not null) filters.Add($"{T(lang, "category")}: {Name(cats, q.CategoryId)}");
        if (q.SourceId is not null) filters.Add($"{T(lang, "source")}: {Name(srcs, q.SourceId)}");
        if (q.PersonId is not null) filters.Add($"{T(lang, "person")}: {Name(people, q.PersonId)}");
        if (q.ProjectId is not null) filters.Add($"{T(lang, "project")}: {Name(projects, q.ProjectId)}");
        if (q.Type is not null) filters.Add($"{T(lang, "type")}: {T(lang, "t" + (int)q.Type)}");
        if (!string.IsNullOrWhiteSpace(q.Currency)) filters.Add($"{T(lang, "currency")}: {q.Currency.ToUpperInvariant()}");
        if (q.MinAmount is not null || q.MaxAmount is not null)
            filters.Add($"{T(lang, "amount")}: {q.MinAmount?.ToString(CultureInfo.InvariantCulture) ?? "…"} – {q.MaxAmount?.ToString(CultureInfo.InvariantCulture) ?? "…"}");
        if (!string.IsNullOrWhiteSpace(q.Q)) filters.Add($"?: {q.Q}");

        // Totals use the same exclusion rules as the dashboard (reversed pairs never counted).
        var summary = await analytics.SummaryAsync(uid, q with { IncludeReversed = false }, ct);
        var series = await analytics.TimeSeriesAsync(uid, q with { IncludeReversed = false }, "month", ct);

        return new ExportTable
        {
            Title = T(lang, "title"), Language = lang, FilterLines = filters, Rows = rows, Totals = summary.Totals,
            GeneratedAt = DateTimeOffset.UtcNow, Series = series,
        };
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
                Csv(r.Date.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)), Csv(r.Type), Csv(r.Wallet),
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

    public static byte[] ToXlsx(ExportTable t)
    {
        var lang = t.Language;
        var sheet1 = new StringBuilder();
        sheet1.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sheet1.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
        sheet1.Append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>");
        sheet1.Append("<cols><col min=\"1\" max=\"1\" width=\"19\" customWidth=\"1\"/><col min=\"2\" max=\"4\" width=\"20\" customWidth=\"1\"/>" +
                      "<col min=\"5\" max=\"5\" width=\"18\" customWidth=\"1\"/><col min=\"6\" max=\"6\" width=\"10\" customWidth=\"1\"/>" +
                      "<col min=\"7\" max=\"7\" width=\"18\" customWidth=\"1\"/><col min=\"8\" max=\"8\" width=\"10\" customWidth=\"1\"/>" +
                      "<col min=\"9\" max=\"12\" width=\"20\" customWidth=\"1\"/><col min=\"13\" max=\"13\" width=\"36\" customWidth=\"1\"/>" +
                      "<col min=\"14\" max=\"14\" width=\"14\" customWidth=\"1\"/></cols>");
        sheet1.Append("<sheetData>");
        var headers = new[] { "date", "type", "wallet", "to_wallet", "amount", "currency", "to_amount", "to_currency",
            "category", "source", "person", "project", "memo", "status" };
        sheet1.Append("<row r=\"1\">");
        for (var c = 0; c < headers.Length; c++) sheet1.Append(StrCell(c, 1, T(lang, headers[c]), 1));
        sheet1.Append("</row>");

        var r = 2;
        foreach (var row in t.Rows)
        {
            sheet1.Append($"<row r=\"{r}\">");
            sheet1.Append($"<c r=\"A{r}\" s=\"3\"><v>{ExcelDate(row.Date).ToString("0.####", CultureInfo.InvariantCulture)}</v></c>");
            sheet1.Append(StrCell(1, r, row.Type));
            sheet1.Append(StrCell(2, r, row.Wallet));
            sheet1.Append(StrCell(3, r, row.ToWallet));
            sheet1.Append($"<c r=\"E{r}\" s=\"2\"><v>{row.Amount.ToString("0.####", CultureInfo.InvariantCulture)}</v></c>");
            sheet1.Append(StrCell(5, r, row.Currency));
            if (row.ToAmount is { } ta) sheet1.Append($"<c r=\"G{r}\" s=\"2\"><v>{ta.ToString("0.####", CultureInfo.InvariantCulture)}</v></c>");
            sheet1.Append(StrCell(7, r, row.ToCurrency));
            sheet1.Append(StrCell(8, r, row.Category));
            sheet1.Append(StrCell(9, r, row.Source));
            sheet1.Append(StrCell(10, r, row.Person));
            sheet1.Append(StrCell(11, r, row.Project));
            sheet1.Append(StrCell(12, r, row.Memo));
            sheet1.Append(StrCell(13, r, row.Status));
            sheet1.Append("</row>");
            r++;
        }
        sheet1.Append("</sheetData></worksheet>");
        var lastRow = Math.Max(2, r - 1);

        // Totals sheet: live SUMIFS formulas over the transactions sheet (+ cached values).
        var sn = SecurityElement.Escape(T(lang, "sheet"));
        var sheet2 = new StringBuilder();
        sheet2.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        sheet2.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><cols><col min=\"1\" max=\"1\" width=\"22\" customWidth=\"1\"/><col min=\"2\" max=\"5\" width=\"20\" customWidth=\"1\"/></cols><sheetData>");
        sheet2.Append("<row r=\"1\">");
        sheet2.Append(StrCell(0, 1, T(lang, "currency"), 1));
        sheet2.Append(StrCell(1, 1, T(lang, "income"), 1));
        sheet2.Append(StrCell(2, 1, T(lang, "expense"), 1));
        sheet2.Append(StrCell(3, 1, T(lang, "net"), 1));
        sheet2.Append("</row>");
        var tr = 2;
        foreach (var tot in t.Totals)
        {
            var incLabel = SecurityElement.Escape(T(lang, "t1"));
            var expLabel = SecurityElement.Escape(T(lang, "t2"));
            var range = $"'{sn}'!$B$2:$B${lastRow}";
            var amt = $"'{sn}'!$E$2:$E${lastRow}";
            var cur = $"'{sn}'!$F$2:$F${lastRow}";
            var status = $"'{sn}'!$N$2:$N${lastRow}";
            var act = SecurityElement.Escape(T(lang, "active"));
            sheet2.Append($"<row r=\"{tr}\">");
            sheet2.Append(StrCell(0, tr, tot.Currency));
            sheet2.Append($"<c r=\"B{tr}\" s=\"2\"><f>SUMIFS({amt},{range},\"{incLabel}\",{cur},$A{tr},{status},\"{act}\")</f><v>{tot.Income.ToString("0.####", CultureInfo.InvariantCulture)}</v></c>");
            sheet2.Append($"<c r=\"C{tr}\" s=\"2\"><f>SUMIFS({amt},{range},\"{expLabel}\",{cur},$A{tr},{status},\"{act}\")</f><v>{tot.Expense.ToString("0.####", CultureInfo.InvariantCulture)}</v></c>");
            sheet2.Append($"<c r=\"D{tr}\" s=\"2\"><f>B{tr}-C{tr}</f><v>{tot.NetFlow.ToString("0.####", CultureInfo.InvariantCulture)}</v></c>");
            sheet2.Append("</row>");
            tr++;
        }
        sheet2.Append("</sheetData></worksheet>");

        const string ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var workbook = $"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"{ns}\" " +
                       "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>" +
                       $"<sheet name=\"{sn}\" sheetId=\"1\" r:id=\"rId1\"/>" +
                       $"<sheet name=\"{SecurityElement.Escape(T(lang, "sheet_totals"))}\" sheetId=\"2\" r:id=\"rId2\"/>" +
                       "</sheets><calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/></workbook>";
        const string styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
            "<numFmts count=\"2\"><numFmt numFmtId=\"164\" formatCode=\"#,##0.00\"/><numFmt numFmtId=\"165\" formatCode=\"yyyy\\-mm\\-dd\\ hh:mm\"/></numFmts>" +
            "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>" +
            "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>" +
            "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFDDE7F5\"/></patternFill></fill></fills>" +
            "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
            "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
            "<cellXfs count=\"4\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
            "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>" +
            "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>" +
            "<xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>";

        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            Add(zip, "[Content_Types].xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>");
            Add(zip, "_rels/.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add(zip, "xl/workbook.xml", workbook);
            Add(zip, "xl/_rels/workbook.xml.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
                "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>" +
                "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
            Add(zip, "xl/styles.xml", styles);
            Add(zip, "xl/worksheets/sheet1.xml", sheet1.ToString());
            Add(zip, "xl/worksheets/sheet2.xml", sheet2.ToString());
        }
        return ms.ToArray();
    }

    private static void Add(ZipArchive zip, string name, string content)
    {
        var e = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var w = new StreamWriter(e.Open(), new UTF8Encoding(false));
        w.Write(content);
    }

    private static string StrCell(int col, int row, string? value, int style = 0)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var text = value;
        // Never let user text be interpreted as a formula by the spreadsheet app (stored as inline string, so safe).
        return $"<c r=\"{ColName(col)}{row}\" t=\"inlineStr\"{(style > 0 ? $" s=\"{style}\"" : "")}>" +
               $"<is><t xml:space=\"preserve\">{SecurityElement.Escape(StripInvalidXml(text))}</t></is></c>";
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

    private static decimal ExcelDate(DateTimeOffset d) =>
        (decimal)(d.UtcDateTime - new DateTime(1899, 12, 30, 0, 0, 0, DateTimeKind.Utc)).TotalDays;
}
