using System.IO.Compression;
using System.Net.Http.Json;
using System.Text.Json;
using System.Xml.Linq;
using Hamyon.Api.Contracts;
using Hamyon.Domain;
using Xunit;

namespace Hamyon.Tests;

/// <summary>Reports: balance history, client-calendar buckets, empty periods, category tree filter, export naming/sheets.</summary>
public class ReportsTests(TestApp app) : IClassFixture<TestApp>
{
    private static readonly TimeSpan Tashkent = TimeSpan.FromHours(5);
    private static DateTimeOffset At(int y, int m, int d, int h = 12) => new(y, m, d, h, 0, 0, Tashkent);
    private static string Iso(DateTimeOffset t) => Uri.EscapeDataString(t.ToString("o"));

    private sealed record Book(ApiUser U, WalletDto Card, WalletDto Cash, WalletDto Usd, CategoryDto Food, CategoryDto Bread, IncomeSourceDto Salary);

    /// <summary>September: +5 000 000 salary. October: -300 000 food, -50 000 bread (sub of food), card -> cash 1 000 000, +200 USD.</summary>
    private async Task<Book> SeedAsync()
    {
        var u = await app.RegisterAsync();
        var card = await u.WalletAsync("Karta", 0);
        var cash = await u.WalletAsync("Naqd", 0);
        var usd = await u.WalletAsync("Dollar", 0, "USD");
        var food = await u.CategoryAsync("Oziq-r");
        var bread = await u.OkAsync<CategoryDto>(await u.Http.PostAsJsonAsync("/api/categories",
            new CategoryRequest("Non-r", null, null, food.Id, null, null, null)));
        var salary = await u.SourceAsync("Maosh-r");

        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/income",
            new IncomeRequest(card.Id, 5_000_000, salary.Id, null, null, null, At(2026, 9, 15), null, null)));
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(card.Id, 300_000, food.Id, null, null, At(2026, 10, 5), null, null)));
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(card.Id, 50_000, bread.Id, null, null, At(2026, 10, 7), null, null)));
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/transfer",
            new TransferRequest(card.Id, cash.Id, 1_000_000, null, null, null, At(2026, 10, 10), null, null)));
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/income",
            new IncomeRequest(usd.Id, 200, salary.Id, null, null, null, At(2026, 10, 12), null, null)));
        return new Book(u, card, cash, usd, food, bread, salary);
    }

    private static string October => $"from={Iso(At(2026, 10, 1, 0))}&to={Iso(new DateTimeOffset(2026, 10, 31, 23, 59, 59, Tashkent))}&tz=300";

    [Fact]
    public async Task Balance_history_has_opening_closing_per_currency_and_transfers_net_to_zero()
    {
        var b = await SeedAsync();
        var json = await b.U.Http.GetFromJsonAsync<JsonElement>($"/api/analytics/balance?granularity=day&{October}");
        var cur = json.GetProperty("currencies").EnumerateArray().ToDictionary(c => c.GetProperty("currency").GetString()!, c => c);

        // UZS: September salary is the opening; October spends 350 000; the card->cash transfer moves money between
        // two wallets of the same user, so the total wallet balance does not change.
        Assert.Equal(5_000_000m, cur["UZS"].GetProperty("opening").GetDecimal());
        Assert.Equal(4_650_000m, cur["UZS"].GetProperty("closing").GetDecimal());
        Assert.Equal(0m, cur["USD"].GetProperty("opening").GetDecimal());
        Assert.Equal(200m, cur["USD"].GetProperty("closing").GetDecimal());

        var pts = cur["UZS"].GetProperty("points").EnumerateArray().ToList();
        Assert.Equal(31, pts.Count); // every day of October, including days without operations
        Assert.Equal("2026-10-01", pts[0].GetProperty("period").GetString());
        Assert.Equal(5_000_000m, pts[0].GetProperty("balance").GetDecimal());
        Assert.Equal(4_700_000m, pts[4].GetProperty("balance").GetDecimal()); // after the 5th
        Assert.Equal(4_650_000m, pts[30].GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Balance_history_for_one_wallet_sees_the_transfer()
    {
        var b = await SeedAsync();
        var json = await b.U.Http.GetFromJsonAsync<JsonElement>($"/api/analytics/balance?granularity=month&walletId={b.Cash.Id}&{October}");
        var uzs = json.GetProperty("currencies").EnumerateArray().Single();
        Assert.Equal(0m, uzs.GetProperty("opening").GetDecimal());
        Assert.Equal(1_000_000m, uzs.GetProperty("closing").GetDecimal());
    }

    [Fact]
    public async Task Long_day_ranges_fall_back_to_coarser_buckets()
    {
        var b = await SeedAsync();
        var json = await b.U.Http.GetFromJsonAsync<JsonElement>(
            $"/api/analytics/balance?granularity=day&from={Iso(At(2020, 1, 1, 0))}&to={Iso(At(2026, 10, 31))}&tz=300");
        Assert.NotEqual("day", json.GetProperty("granularity").GetString());
        Assert.All(json.GetProperty("currencies").EnumerateArray(), c => Assert.True(c.GetProperty("points").GetArrayLength() <= 400));
    }

    [Fact]
    public async Task Timeseries_fills_empty_periods_with_zeros_in_the_client_calendar()
    {
        var b = await SeedAsync();
        var pts = (await b.U.Http.GetFromJsonAsync<JsonElement>($"/api/analytics/timeseries?granularity=day&currency=UZS&{October}"))
            .EnumerateArray().Where(p => p.GetProperty("currency").GetString() == "UZS").ToList();
        Assert.Equal(31, pts.Count);
        Assert.Equal(300_000m, pts.Single(p => p.GetProperty("period").GetString() == "2026-10-05").GetProperty("expense").GetDecimal());
        Assert.Equal(0m, pts.Single(p => p.GetProperty("period").GetString() == "2026-10-06").GetProperty("expense").GetDecimal());
    }

    [Fact]
    public async Task Day_buckets_follow_the_client_offset_not_utc()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Tz", 1_000);
        var c = await u.CategoryAsync("Tzc");
        // 00:30 in Tashkent on Oct 27 = 19:30 UTC on Oct 26
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(w.Id, 10, c.Id, null, null, new DateTimeOffset(2026, 10, 27, 0, 30, 0, Tashkent), null, null)));
        var local = (await u.Http.GetFromJsonAsync<JsonElement>("/api/analytics/timeseries?granularity=day&tz=300")).EnumerateArray().Single();
        var utc = (await u.Http.GetFromJsonAsync<JsonElement>("/api/analytics/timeseries?granularity=day")).EnumerateArray().Single();
        Assert.Equal("2026-10-27", local.GetProperty("period").GetString());
        Assert.Equal("2026-10-26", utc.GetProperty("period").GetString());
    }

    [Fact]
    public async Task Parent_category_filter_includes_sub_categories_and_a_sub_category_only_itself()
    {
        var b = await SeedAsync();
        var parent = await b.U.Http.GetFromJsonAsync<JsonElement>($"/api/analytics/summary?categoryId={b.Food.Id}");
        var child = await b.U.Http.GetFromJsonAsync<JsonElement>($"/api/analytics/summary?categoryId={b.Bread.Id}");
        Assert.Equal(350_000m, parent.GetProperty("totals")[0].GetProperty("expense").GetDecimal());
        Assert.Equal(50_000m, child.GetProperty("totals")[0].GetProperty("expense").GetDecimal());
    }

    [Fact]
    public async Task Wallet_filter_does_not_count_a_transfer_as_income_or_expense()
    {
        var b = await SeedAsync();
        var json = await b.U.Http.GetFromJsonAsync<JsonElement>($"/api/analytics/summary?walletId={b.Cash.Id}&{October}");
        Assert.Empty(json.GetProperty("totals").EnumerateArray()); // the cash wallet only received a transfer
    }

    [Theory]
    [InlineData("uz", "", "RaqamliHamyon_2026-10_Oylik.xlsx")]
    [InlineData("uz", "&type=2&currency=uzs", "RaqamliHamyon_2026-10_Oylik_Xarajat_UZS.xlsx")]
    [InlineData("en", "&type=1", "RaqamliHamyon_2026-10_Monthly_Income.xlsx")]
    public async Task Export_file_name_carries_period_and_filters(string lang, string extra, string expected)
    {
        var b = await SeedAsync();
        var res = await b.U.Http.GetAsync($"/api/reports/export?format=xlsx&lang={lang}&{October}{extra}");
        res.EnsureSuccessStatusCode();
        Assert.Equal(expected, res.Content.Headers.ContentDisposition?.FileNameStar ?? res.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
    }

    [Fact]
    public async Task Export_custom_range_with_wallet_is_named_by_dates()
    {
        var b = await SeedAsync();
        var res = await b.U.Http.GetAsync(
            $"/api/reports/export?format=xlsx&lang=uz&tz=300&walletId={b.Card.Id}&from={Iso(At(2026, 10, 1, 0))}&to={Iso(At(2026, 10, 27, 23))}");
        res.EnsureSuccessStatusCode();
        var name = res.Content.Headers.ContentDisposition?.FileNameStar ?? res.Content.Headers.ContentDisposition?.FileName?.Trim('"');
        Assert.Equal("RaqamliHamyon_2026-10-01_2026-10-27_Hamyon.xlsx", name);
    }

    [Fact]
    public async Task Xlsx_has_five_sheets_with_summary_balances_wallets_and_filters()
    {
        var b = await SeedAsync();
        var bytes = await b.U.Http.GetByteArrayAsync($"/api/reports/export?format=xlsx&lang=uz&currency=UZS&{October}");
        using var zip = new ZipArchive(new MemoryStream(bytes));
        foreach (var e in zip.Entries)
        {
            using var st = e.Open();
            XDocument.Load(st); // every part is well-formed XML
        }
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XDocument Part(string n) { using var s = zip.GetEntry(n)!.Open(); return XDocument.Load(s); }
        string[] Texts(XElement row) => row.Descendants(ns + "t").Select(t => t.Value).ToArray();

        var names = Part("xl/workbook.xml").Descendants(ns + "sheet").Select(s => (string)s.Attribute("name")!).ToArray();
        Assert.Equal(["Xulosa", "Operatsiyalar", "Toifalar", "Hamyonlar", "Filtrlar"], names);

        // summary: UZS row = income 0 in October, expense 350 000, opening 5 000 000, closing 4 650 000, top = Oziq-r / Non-r? no: Oziq-r 300 000
        var summary = Part("xl/worksheets/sheet2.xml");
        var uzs = summary.Descendants(ns + "row").Single(r => Texts(r).Contains("UZS"));
        decimal V(string col) => decimal.Parse(uzs.Elements(ns + "c").Single(c => ((string)c.Attribute("r")!).StartsWith(col)).Element(ns + "v")!.Value,
            System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(350_000m, V("C"));
        Assert.Equal(5_000_000m, V("E"));
        Assert.Equal(4_650_000m, V("F"));
        Assert.Contains("Oziq-r", Texts(uzs));
        Assert.Contains(summary.Descendants(ns + "pane"), p => (string)p.Attribute("state")! == "frozen");

        // categories: the bread expense is listed under its parent as a sub-category
        var cats = Part("xl/worksheets/sheet3.xml").Descendants(ns + "row").Select(Texts).ToList();
        Assert.Contains(cats, r => r.Contains("Oziq-r") && r.Contains("Non-r"));

        // wallets: card opening 5 000 000 -> closing 3 650 000 (two expenses + transfer out)
        var wallets = Part("xl/worksheets/sheet4.xml").Descendants(ns + "row").ToList();
        var card = wallets.Single(r => Texts(r).Contains("Karta"));
        Assert.Equal("3650000", card.Elements(ns + "c").Single(c => ((string)c.Attribute("r")!).StartsWith('D')).Element(ns + "v")!.Value);

        // applied filters: period and currency
        var filters = Part("xl/worksheets/sheet5.xml").Descendants(ns + "row").Select(Texts).ToList();
        Assert.Contains(filters, r => r.Contains("Valyuta") && r.Contains("UZS"));
        Assert.Contains(filters, r => r.Contains("Davr") && r.Any(x => x.StartsWith("2026-10-01")));
    }

    [Fact]
    public async Task Export_dates_are_in_the_client_calendar()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Csv-tz", 1_000);
        var c = await u.CategoryAsync("Csv-tzc");
        await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(w.Id, 10, c.Id, null, null, new DateTimeOffset(2026, 10, 27, 0, 30, 0, Tashkent), null, null)));
        var csv = System.Text.Encoding.UTF8.GetString(await u.Http.GetByteArrayAsync("/api/reports/export?format=csv&tz=300&type=2"));
        Assert.Contains("2026-10-27 00:30:00", csv);
    }
}
