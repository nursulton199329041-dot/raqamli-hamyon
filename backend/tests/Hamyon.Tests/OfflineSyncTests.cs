using System.Net.Http.Json;
using System.Text.Json;
using Hamyon.Api.Contracts;
using Xunit;

namespace Hamyon.Tests;

/// <summary>V6 Phase 3: objects created offline keep the ids the device chose, and every push is safe to repeat.</summary>
public sealed class OfflineSyncTests(TestApp app) : IClassFixture<TestApp>
{
    private static async Task<List<JsonElement>> PushAsync(ApiUser u, params object[] ops)
    {
        var res = await u.Http.PostAsJsonAsync("/api/sync/push", new { operations = ops });
        var body = await u.OkAsync<JsonElement>(res);
        return body.GetProperty("results").EnumerateArray().ToList();
    }

    private static object Op(string kind, object payload, Guid? target = null) =>
        new { clientOperationId = Guid.NewGuid().ToString(), kind, payload, targetId = target };

    private static string Status(JsonElement r) => r.GetProperty("status").GetString()!;

    private static async Task<JsonElement> PullAsync(ApiUser u) =>
        await u.Http.GetFromJsonAsync<JsonElement>("/api/sync/pull");

    [Fact]
    public async Task Offline_created_catalog_and_operations_keep_client_ids_and_replay_as_duplicates()
    {
        var u = await app.RegisterAsync();
        var wallet = Guid.NewGuid();
        var opening = Guid.NewGuid();
        var cat = Guid.NewGuid();
        var sub = Guid.NewGuid();
        var src = Guid.NewGuid();
        var income = Guid.NewGuid();
        var expense = Guid.NewGuid();

        var ops = new[]
        {
            Op("wallet.create", new { id = wallet, openingId = opening, name = "Naqd", type = 0, currency = "UZS", initialBalance = 100_000m, allowOverdraft = false }),
            Op("category.create", new { id = cat, name = "Kafe" }),
            Op("category.create", new { id = sub, name = "Qahva", parentId = cat }),
            Op("source.create", new { id = src, name = "Frilans" }),
            Op("income", new { id = income, walletId = wallet, amount = 50_000m, incomeSourceId = src }),
            Op("expense", new { id = expense, walletId = wallet, amount = 30_000m, categoryId = sub }),
        };
        var first = await PushAsync(u, ops);
        Assert.All(first, r => Assert.Equal("applied", Status(r)));

        // the same batch again (lost response): nothing is created twice
        var again = await PushAsync(u, ops);
        Assert.All(again, r => Assert.Equal("duplicate", Status(r)));

        Assert.Equal(120_000m, await u.BalanceAsync(wallet));
        var pull = await PullAsync(u);
        var ids = pull.GetProperty("transactions").EnumerateArray().Select(t => t.GetProperty("id").GetGuid()).ToList();
        Assert.Contains(opening, ids);
        Assert.Contains(income, ids);
        Assert.Contains(expense, ids);
        Assert.Equal(3, ids.Count);
        // lines travel as (kind, ref, currency, amount) so the device can rebuild the same double entry
        var openLines = pull.GetProperty("lines").GetProperty(opening.ToString()).EnumerateArray()
            .Select(l => (Kind: l.GetProperty("kind").GetInt32(), Ref: l.GetProperty("refId").GetGuid(), Amount: l.GetProperty("amount").GetDecimal()))
            .OrderBy(l => l.Kind).ToList();
        Assert.Equal([(0, wallet, 100_000m), (4, Guid.Empty, -100_000m)], openLines);
        Assert.Contains(pull.GetProperty("categories").EnumerateArray(), c => c.GetProperty("id").GetGuid() == sub
            && c.GetProperty("parentId").GetGuid() == cat);
        Assert.Contains(pull.GetProperty("incomeSources").EnumerateArray(), c => c.GetProperty("id").GetGuid() == src);
    }

    [Fact]
    public async Task Offline_debt_repay_reverse_and_wallet_update_sync_with_client_ids()
    {
        var u = await app.RegisterAsync();
        var wallet = Guid.NewGuid();
        var person = Guid.NewGuid();
        var debt = Guid.NewGuid();
        var lend = Guid.NewGuid();
        var repay = Guid.NewGuid();
        var reversal = Guid.NewGuid();
        var res = await PushAsync(u,
            Op("wallet.create", new { id = wallet, name = "Karta", type = 1, currency = "UZS", initialBalance = 500_000m }),
            Op("debt", new { id = lend, debtId = debt, direction = 1, personId = person, personName = "Ali", walletId = wallet, amount = 200_000m }),
            Op("repay", new { id = repay, walletId = wallet, amount = 50_000m }, debt),
            Op("reverse", new { id = reversal, memo = "xato" }, repay),
            Op("wallet.update", new { name = "Asosiy karta", color = "#000000" }, wallet));
        Assert.All(res, r => Assert.Equal("applied", Status(r)));

        Assert.Equal(300_000m, await u.BalanceAsync(wallet)); // 500 - 200 lent, repay 50 reversed
        var pull = await PullAsync(u);
        var d = pull.GetProperty("debts").EnumerateArray().Single();
        Assert.Equal(debt, d.GetProperty("id").GetGuid());
        Assert.Equal(person, d.GetProperty("personId").GetGuid());
        Assert.Equal(200_000m, d.GetProperty("outstanding").GetDecimal());
        Assert.Contains(pull.GetProperty("people").EnumerateArray(), p => p.GetProperty("id").GetGuid() == person);
        var rev = pull.GetProperty("transactions").EnumerateArray().Single(t => t.GetProperty("id").GetGuid() == reversal);
        Assert.Equal(repay, rev.GetProperty("reversalOfId").GetGuid());
        var w = pull.GetProperty("wallets").EnumerateArray().Single();
        Assert.Equal("Asosiy karta", w.GetProperty("name").GetString());

        // a second debt for the now-known person needs no name; the reverse replays as duplicate
        var more = await PushAsync(u,
            Op("debt", new { id = Guid.NewGuid(), debtId = Guid.NewGuid(), direction = 0, personId = person, walletId = wallet, amount = 10_000m }),
            Op("reverse", new { id = Guid.NewGuid() }, repay));
        Assert.Equal("applied", Status(more[0]));
        Assert.Equal("duplicate", Status(more[1]));
    }

    [Fact]
    public async Task Rejected_operations_are_reported_never_forced()
    {
        var u = await app.RegisterAsync();
        var other = await app.RegisterAsync();
        var wallet = Guid.NewGuid();
        await PushAsync(u, Op("wallet.create", new { id = wallet, name = "Naqd", type = 0, currency = "UZS", initialBalance = 1_000m }));

        var res = await PushAsync(u,
            Op("expense", new { id = Guid.NewGuid(), walletId = wallet, amount = 5_000m, categoryId = Guid.NewGuid() }),
            Op("category.create", new { name = "id yo'q" }),
            Op("wallet.create", new { id = Guid.Empty, name = "Bo'sh", type = 0, currency = "UZS", initialBalance = 0m }));
        Assert.All(res, r => Assert.Equal("rejected", Status(r)));
        Assert.Equal("sync.id_invalid", res[1].GetProperty("errorCode").GetString());

        // another user cannot take over an existing id
        var stolen = await PushAsync(other, Op("wallet.create", new { id = wallet, name = "Meniki", type = 0, currency = "UZS", initialBalance = 0m }));
        Assert.Equal("rejected", Status(stolen[0]));
        Assert.Equal(1_000m, await u.BalanceAsync(wallet));
    }
}
