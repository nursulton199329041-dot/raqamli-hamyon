using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hamyon.Api.Contracts;
using Hamyon.Api.Endpoints;
using Hamyon.Api.Reports;
using Hamyon.Domain;
using Xunit;

namespace Hamyon.Tests;

public sealed class ProfilesAndFxTests(TestApp app) : IClassFixture<TestApp>
{
    private static void UseProfile(ApiUser u, Guid? profileId)
    {
        u.Http.DefaultRequestHeaders.Remove(ProfileEndpoints.Header);
        if (profileId is { } id) u.Http.DefaultRequestHeaders.Add(ProfileEndpoints.Header, id.ToString());
    }

    private static async Task<ProfileDto> CreateProfileAsync(ApiUser u, string name, string currency = "UZS")
    {
        var res = await u.Http.PostAsJsonAsync("/api/profiles", new ProfileCreateRequest(name, currency, null, null));
        return await u.OkAsync<ProfileDto>(res);
    }

    private static async Task<JsonElement> SummaryAsync(ApiUser u) =>
        await u.Http.GetFromJsonAsync<JsonElement>("/api/analytics/summary");

    private static decimal ExpenseIn(JsonElement summary, string currency) =>
        summary.GetProperty("totals").EnumerateArray()
            .Where(t => t.GetProperty("currency").GetString() == currency)
            .Select(t => t.GetProperty("expense").GetDecimal()).DefaultIfEmpty(0m).Single();

    // ------------------------------------------------------------------ profiles

    [Fact]
    public async Task New_account_starts_with_one_main_profile_marked_current()
    {
        var u = await app.RegisterAsync();
        var list = await u.Http.GetFromJsonAsync<List<ProfileDto>>("/api/profiles");
        var p = Assert.Single(list!);
        Assert.Equal("Asosiy", p.Name);
        Assert.True(p.IsCurrent);
    }

    [Fact]
    public async Task Two_profiles_of_one_account_never_mix_wallets_categories_operations_or_reports()
    {
        var u = await app.RegisterAsync();
        var main = (await u.Http.GetFromJsonAsync<List<ProfileDto>>("/api/profiles"))!.Single();
        var cash = await u.WalletAsync("Naqd", 500_000);
        var cat = await u.CategoryAsync("Oziq");
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(cash.Id, 100_000, cat.Id));

        var family = await CreateProfileAsync(u, "Oila");
        UseProfile(u, family.Id);
        Assert.Empty((await u.Http.GetFromJsonAsync<List<WalletDto>>("/api/wallets"))!);
        var famCats = await u.Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories");
        Assert.DoesNotContain(famCats!, c => c.Id == cat.Id); // own default categories only
        Assert.NotEmpty(famCats!);
        Assert.Empty((await u.Http.GetFromJsonAsync<JsonElement>("/api/transactions")).GetProperty("items").EnumerateArray().ToList());
        Assert.Equal(0m, ExpenseIn(await SummaryAsync(u), "UZS"));

        // ids of the other profile are simply not found here
        await u.ErrorAsync(await u.ExpenseAsync(cash.Id, 1_000, famCats![0].Id), HttpStatusCode.NotFound);
        var famWallet = await u.WalletAsync("Oila kartasi", 50_000);
        await u.ErrorAsync(await u.ExpenseAsync(famWallet.Id, 1_000, cat.Id), HttpStatusCode.NotFound);
        await u.OkAsync<OperationResult>(await u.ExpenseAsync(famWallet.Id, 20_000, famCats[0].Id));

        UseProfile(u, main.Id);
        Assert.Equal(400_000m, await u.BalanceAsync(cash.Id));
        Assert.Equal(100_000m, ExpenseIn(await SummaryAsync(u), "UZS"));
        Assert.DoesNotContain((await u.Http.GetFromJsonAsync<List<WalletDto>>("/api/wallets"))!, w => w.Id == famWallet.Id);

        UseProfile(u, family.Id);
        Assert.Equal(30_000m, await u.BalanceAsync(famWallet.Id));
        Assert.Equal(20_000m, ExpenseIn(await SummaryAsync(u), "UZS"));
        var recon = await u.Http.GetFromJsonAsync<JsonElement>("/api/reconciliation");
        Assert.True(recon.GetProperty("ok").GetBoolean()); // each profile's books balance on their own
    }

    [Fact]
    public async Task Another_account_cannot_use_my_profile_or_my_ids()
    {
        var a = await app.RegisterAsync();
        var aMain = (await a.Http.GetFromJsonAsync<List<ProfileDto>>("/api/profiles"))!.Single();
        var aWallet = await a.WalletAsync("A", 10_000);

        var b = await app.RegisterAsync();
        UseProfile(b, aMain.Id);
        await b.ErrorAsync(await b.Http.GetAsync("/api/wallets"), HttpStatusCode.NotFound);
        UseProfile(b, null);
        var bCat = (await b.Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories"))![0];
        await b.ErrorAsync(await b.ExpenseAsync(aWallet.Id, 1_000, bCat.Id), HttpStatusCode.NotFound);
        Assert.Equal(10_000m, await a.BalanceAsync(aWallet.Id));
        var bList = await b.Http.GetFromJsonAsync<List<ProfileDto>>("/api/profiles");
        Assert.DoesNotContain(bList!, p => p.Id == aMain.Id);

        UseProfile(b, Guid.NewGuid());
        await b.ErrorAsync(await b.Http.GetAsync("/api/wallets"), HttpStatusCode.NotFound);
        b.Http.DefaultRequestHeaders.Remove(ProfileEndpoints.Header);
        b.Http.DefaultRequestHeaders.Add(ProfileEndpoints.Header, "not-a-guid");
        await b.ErrorAsync(await b.Http.GetAsync("/api/wallets"), HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Profile_edits_detect_concurrent_changes_and_the_last_active_profile_stays()
    {
        var u = await app.RegisterAsync();
        var main = (await u.Http.GetFromJsonAsync<List<ProfileDto>>("/api/profiles"))!.Single();
        var renamed = await u.OkAsync<ProfileDto>(await u.Http.PatchAsJsonAsync($"/api/profiles/{main.Id}",
            new ProfileUpdateRequest("Shaxsiy", null, "#1FCB8B", null, null, main.Revision)));
        Assert.Equal("Shaxsiy", renamed.Name);
        Assert.Equal(main.Revision + 1, renamed.Revision);

        // a second device still holding the old revision is told, not silently overwritten
        var stale = await u.Http.PatchAsJsonAsync($"/api/profiles/{main.Id}", new ProfileUpdateRequest("Eski", null, null, null, null, main.Revision));
        Assert.Equal("conflict.stale", (await u.ErrorAsync(stale, HttpStatusCode.Conflict)).Code);

        var last = await u.Http.PatchAsJsonAsync($"/api/profiles/{main.Id}", new ProfileUpdateRequest(null, null, null, null, true, renamed.Revision));
        Assert.Equal("profile.last_active", (await u.ErrorAsync(last, HttpStatusCode.Conflict)).Code);
    }

    // ------------------------------------------------------------------ cross-currency expense

    [Fact]
    public async Task Usd_wallet_pays_a_uzs_expense_at_the_given_rate_and_reports_count_it_in_uzs()
    {
        var u = await app.RegisterAsync();
        var usd = await u.WalletAsync("Dollar", 100, "USD");
        var cat = await u.CategoryAsync("Kafe");

        var res = await u.Http.PostAsJsonAsync("/api/transactions/expense", new ExpenseRequest(usd.Id, 12, cat.Id, null, null, null,
            "tushlik", "fx-1", ToCurrency: "UZS", FxRate: 12_000, RateDate: new DateOnly(2026, 10, 28), RateSource: "manual"));
        var op = await u.OkAsync<OperationResult>(res);
        Assert.Equal(12m, op.Transaction.Amount);
        Assert.Equal("USD", op.Transaction.Currency);
        Assert.Equal(144_000m, op.Transaction.ToAmount);
        Assert.Equal("UZS", op.Transaction.ToCurrency);
        Assert.Equal(12_000m, op.Transaction.FxRate);
        Assert.Equal(new DateOnly(2026, 10, 28), op.Transaction.RateDate);
        Assert.Equal("manual", op.Transaction.RateSource);

        Assert.Equal(88m, await u.BalanceAsync(usd.Id)); // wallet loses dollars only
        var summary = await SummaryAsync(u);
        Assert.Equal(144_000m, ExpenseIn(summary, "UZS")); // the expense is 144 000 UZS ...
        Assert.Equal(0m, ExpenseIn(summary, "USD"));       // ... not 12 USD of spending
        var breakdown = await u.Http.GetFromJsonAsync<List<BreakdownRow>>("/api/analytics/breakdown?by=category");
        var row = Assert.Single(breakdown!, r => r.Id == cat.Id);
        Assert.Equal(("UZS", 144_000m), (row.Currency, row.Total));
        Assert.True((await u.Http.GetFromJsonAsync<JsonElement>("/api/reconciliation")).GetProperty("ok").GetBoolean());

        // offline retry of the same operation is not written twice; reusing the key for other data is refused
        var again = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(usd.Id, 12, cat.Id, null, null, null, "tushlik", "fx-1", ToCurrency: "UZS", FxRate: 12_000,
                RateDate: new DateOnly(2026, 10, 28), RateSource: "manual")));
        Assert.True(again.Replayed);
        Assert.Equal(88m, await u.BalanceAsync(usd.Id));
        var reused = await u.Http.PostAsJsonAsync("/api/transactions/expense", new ExpenseRequest(usd.Id, 12, cat.Id, null, null, null,
            null, "fx-1", ToCurrency: "UZS", FxRate: 12_500));
        Assert.Equal("idempotency.key_reused", (await u.ErrorAsync(reused, HttpStatusCode.Conflict)).Code);

        // reversal restores the wallet and removes the expense; the stored rate is kept on both entries
        var rev = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync($"/api/transactions/{op.Transaction.Id}/reverse", new { }));
        Assert.Equal(12_000m, rev.Transaction.FxRate);
        Assert.Equal(100m, await u.BalanceAsync(usd.Id));
        Assert.Equal(0m, ExpenseIn(await SummaryAsync(u), "UZS"));
    }

    [Fact]
    public async Task Converted_amount_given_by_the_user_derives_the_rate_and_rounding_follows_the_currency()
    {
        var u = await app.RegisterAsync();
        var usd = await u.WalletAsync("Dollar", 50, "USD");
        var cat = await u.CategoryAsync("Taksi");
        var op = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(usd.Id, 3, cat.Id, null, null, null, null, null, ToCurrency: "UZS", ToAmount: 37_000)));
        Assert.Equal(12_333.33333333m, op.Transaction.FxRate); // 8 places, half away from zero
        Assert.Equal("manual", op.Transaction.RateSource);
        Assert.NotNull(op.Transaction.RateDate);

        var rounded = await u.OkAsync<OperationResult>(await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(usd.Id, 1.15m, cat.Id, null, null, null, null, null, ToCurrency: "UZS", FxRate: 12_345.678m)));
        Assert.Equal(14_197.53m, rounded.Transaction.ToAmount); // 14 197.5297 -> 2 places for UZS
    }

    [Fact]
    public async Task Conversion_needs_a_rate_and_same_currency_expenses_cannot_carry_one()
    {
        var u = await app.RegisterAsync();
        var usd = await u.WalletAsync("Dollar", 50, "USD");
        var uzs = await u.WalletAsync("Naqd", 50_000);
        var cat = await u.CategoryAsync("X");
        var noRate = await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(usd.Id, 1, cat.Id, null, null, null, null, null, ToCurrency: "UZS"));
        Assert.Equal("fx.rate_required", (await u.ErrorAsync(noRate, HttpStatusCode.BadRequest)).Code);
        var same = await u.Http.PostAsJsonAsync("/api/transactions/expense",
            new ExpenseRequest(uzs.Id, 1_000, cat.Id, null, null, null, null, null, ToCurrency: "UZS", FxRate: 2));
        Assert.Equal("expense.fx_same_currency", (await u.ErrorAsync(same, HttpStatusCode.BadRequest)).Code);
        Assert.Equal(50m, await u.BalanceAsync(usd.Id));
        Assert.Equal(50_000m, await u.BalanceAsync(uzs.Id));
    }

    [Fact]
    public async Task Offline_queue_replays_a_converted_expense_once_in_the_profile_it_was_made_in()
    {
        var u = await app.RegisterAsync();
        var second = await CreateProfileAsync(u, "Biznes", "USD");
        UseProfile(u, second.Id);
        var usd = await u.WalletAsync("Biznes USD", 40, "USD");
        var cat = (await u.Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories"))![0];
        var payload = JsonSerializer.SerializeToElement(new
        {
            walletId = usd.Id, amount = 2, categoryId = cat.Id, toCurrency = "UZS", fxRate = 12_100, rateSource = "manual",
        });
        var push = new { operations = new[] { new { clientOperationId = "off-1", kind = "expense", payload, targetId = (Guid?)null } } };
        var first = await u.Http.PostAsJsonAsync("/api/sync/push", push);
        var dup = await u.Http.PostAsJsonAsync("/api/sync/push", push);
        Assert.Equal("applied", (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("results")[0].GetProperty("status").GetString());
        Assert.Equal("duplicate", (await dup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("results")[0].GetProperty("status").GetString());
        Assert.Equal(38m, await u.BalanceAsync(usd.Id));
        Assert.Equal(24_200m, ExpenseIn(await SummaryAsync(u), "UZS"));

        UseProfile(u, null); // main profile: untouched
        Assert.Equal(0m, ExpenseIn(await SummaryAsync(u), "UZS"));
    }
}
