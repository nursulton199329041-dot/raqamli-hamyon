using System.IO.Compression;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Hamyon.Api.Contracts;
using Hamyon.Domain;
using Xunit;

namespace Hamyon.Tests;

public class AnalyticsTests(TestApp app) : IClassFixture<TestApp>
{
    private sealed record Seeded(ApiUser U, WalletDto W, CategoryDto Food, CategoryDto Fuel);

    private async Task<Seeded> SeedAsync()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Asosiy", 1_000_000);
        var usd = await u.WalletAsync("Dollar", 500, "USD");
        var food = await u.CategoryAsync("Ovqat-t");
        var fuel = await u.CategoryAsync("Yoqilgi-t");
        var src = await u.SourceAsync("Maosh-t");
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 2_000_000, src.Id, memo: "Oylik"));
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 300_000, food.Id));
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 100_000, fuel.Id, memo: "Metan"));
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(usd.Id, 50, food.Id));
        // noise that must NOT count as income/expense
        var other = await u.WalletAsync("Boshqa", 0);
        await u.OkAsync<OperationResult>(await u.TransferAsync(w.Id, other.Id, 400_000));
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/debts",
            new DebtRequest(DebtDirection.Borrowed, null, "Hamkor", w.Id, 700_000, null, null, null, null, null, null)));
        return new Seeded(u, w, food, fuel);
    }

    [Fact]
    public async Task Summary_separates_currencies_and_excludes_transfers_and_debts()
    {
        var s = await SeedAsync();
        var json = await s.U.Http.GetFromJsonAsync<JsonElement>("/api/analytics/summary");
        var totals = json.GetProperty("totals").EnumerateArray().ToDictionary(
            e => e.GetProperty("currency").GetString()!, e => e);

        Assert.Equal(2_000_000m, totals["UZS"].GetProperty("income").GetDecimal());
        Assert.Equal(400_000m, totals["UZS"].GetProperty("expense").GetDecimal());
        Assert.Equal(1_600_000m, totals["UZS"].GetProperty("netFlow").GetDecimal());
        Assert.Equal(700_000m, totals["UZS"].GetProperty("borrowed").GetDecimal());
        Assert.Equal(0m, totals["USD"].GetProperty("income").GetDecimal());
        Assert.Equal(50m, totals["USD"].GetProperty("expense").GetDecimal());

        var debt = json.GetProperty("debts").EnumerateArray().Single();
        Assert.Equal(700_000m, debt.GetProperty("iOwe").GetDecimal());
    }

    [Fact]
    public async Task Breakdown_percentages_add_up_per_currency()
    {
        var s = await SeedAsync();
        var rows = (await s.U.Http.GetFromJsonAsync<JsonElement>("/api/analytics/breakdown?by=category")).EnumerateArray().ToList();
        var uzs = rows.Where(r => r.GetProperty("currency").GetString() == "UZS").ToList();
        Assert.Equal(100m, uzs.Sum(r => r.GetProperty("percent").GetDecimal()));
        var top = uzs.First();
        Assert.Equal("Ovqat-t", top.GetProperty("name").GetString());
        Assert.Equal(75m, top.GetProperty("percent").GetDecimal());
    }

    [Fact]
    public async Task Timeseries_groups_by_period()
    {
        var s = await SeedAsync();
        var pts = (await s.U.Http.GetFromJsonAsync<JsonElement>("/api/analytics/timeseries?granularity=month"))
            .EnumerateArray().Where(p => p.GetProperty("currency").GetString() == "UZS").ToList();
        Assert.Single(pts);
        Assert.Equal(2_000_000m, pts[0].GetProperty("income").GetDecimal());
        Assert.Equal(400_000m, pts[0].GetProperty("expense").GetDecimal());
    }

    [Fact]
    public async Task Budget_limit_reports_exceeded()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("B", 1_000_000);
        var res = await u.Http.PostAsJsonAsync("/api/categories",
            new CategoryRequest("Limitli", null, null, null, 100_000, "UZS", null));
        var cat = (await res.Content.ReadFromJsonAsync<CategoryDto>())!;
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 120_000, cat.Id));
        var b = (await u.Http.GetFromJsonAsync<JsonElement>("/api/analytics/budgets")).EnumerateArray().Single();
        Assert.True(b.GetProperty("exceeded").GetBoolean());
        Assert.Equal(120m, b.GetProperty("percent").GetDecimal());
    }

    [Fact]
    public async Task Reversed_expense_does_not_count()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("R", 1_000);
        var cat = await u.CategoryAsync("Rcat");
        var e = await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 100, cat.Id));
        await u.Http.PostAsync($"/api/transactions/{e.Transaction.Id}/reverse", null);
        var json = await u.Http.GetFromJsonAsync<JsonElement>("/api/analytics/summary");
        Assert.Empty(json.GetProperty("totals").EnumerateArray());
    }

    [Fact]
    public async Task Csv_export_matches_filters_and_neutralizes_formulas()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Csv", 1_000);
        var cat = await u.CategoryAsync("CsvCat");
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 10, cat.Id, memo: "=HYPERLINK(\"http://x\")"));
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(w.Id, 20, cat.Id, memo: "oddiy, vergulli"));

        var bytes = await u.Http.GetByteArrayAsync("/api/reports/export?format=csv&minAmount=15");
        Assert.Equal(0xEF, bytes[0]);
        var text = Encoding.UTF8.GetString(bytes);
        Assert.Contains("\"oddiy, vergulli\"", text);
        Assert.DoesNotContain("HYPERLINK", text); // filtered out by amount

        var all = Encoding.UTF8.GetString(await u.Http.GetByteArrayAsync("/api/reports/export?format=csv"));
        Assert.Contains("'=HYPERLINK", all);
    }

    [Fact]
    public async Task Xlsx_export_is_a_valid_package_with_matching_totals()
    {
        var s = await SeedAsync();
        var bytes = await s.U.Http.GetByteArrayAsync("/api/reports/export?format=xlsx&lang=uz");
        using var zip = new ZipArchive(new MemoryStream(bytes));
        Assert.NotNull(zip.GetEntry("xl/workbook.xml"));
        var names = zip.Entries.Select(e => e.FullName).ToHashSet();
        Assert.Contains("[Content_Types].xml", names);

        // every part is well-formed XML
        foreach (var e in zip.Entries)
        {
            using var st = e.Open();
            XDocument.Load(st);
        }

        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        using var sheet2 = zip.GetEntry("xl/worksheets/sheet2.xml")!.Open();
        var doc = XDocument.Load(sheet2);
        var rows = doc.Descendants(ns + "row").Skip(1).ToList();
        var uzsRow = rows.Single(r => r.Descendants(ns + "t").Any(t => t.Value == "UZS"));
        var cells = uzsRow.Elements(ns + "c").ToList();
        var incomeCell = cells.Single(c => ((string)c.Attribute("r")!).StartsWith('B'));
        Assert.Equal("2000000", incomeCell.Element(ns + "v")!.Value);
        Assert.Contains(cells, c => c.Element(ns + "f") is not null);

        using var sheet1 = zip.GetEntry("xl/worksheets/sheet1.xml")!.Open();
        var data = XDocument.Load(sheet1).Descendants(ns + "row").Count() - 1;
        var list = await s.U.Http.GetFromJsonAsync<PagedResult<TransactionDto>>("/api/transactions?pageSize=200");
        Assert.Equal(list!.Total, data);
    }

    [Fact]
    public async Task Pdf_export_has_pdf_structure()
    {
        var s = await SeedAsync();
        var bytes = await s.U.Http.GetByteArrayAsync("/api/reports/export?format=pdf&lang=ru");
        var head = Encoding.ASCII.GetString(bytes, 0, 8);
        Assert.StartsWith("%PDF-1.4", head);
        var tail = Encoding.ASCII.GetString(bytes, bytes.Length - 6, 6);
        Assert.Contains("%%EOF", tail);
        var all = Encoding.Latin1.GetString(bytes);
        Assert.Contains("/Type /Page ", all);
        Assert.Contains("Finansovyy otchyot", all); // cyrillic title transliterated
        Assert.Contains("startxref", all);
    }

    [Fact]
    public async Task Export_rejects_unknown_format()
    {
        var u = await app.RegisterAsync();
        var res = await u.Http.GetAsync("/api/reports/export?format=docx");
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, res.StatusCode);
    }
}
