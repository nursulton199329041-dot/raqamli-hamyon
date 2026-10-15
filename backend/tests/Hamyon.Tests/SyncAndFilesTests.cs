using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Api.Endpoints;
using Hamyon.Domain;
using Xunit;

namespace Hamyon.Tests;

public class SyncAndFilesTests(TestApp app) : IClassFixture<TestApp>
{
    private static JsonElement P(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    [Fact]
    public async Task Offline_batch_replay_creates_no_duplicates()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Offline", 1_000);
        var cat = await u.CategoryAsync("Off-cat");

        var ops = new[]
        {
            new SyncOperation("op-" + Guid.NewGuid().ToString("N"), "expense",
                P(new ExpenseRequest(w.Id, 100, cat.Id, null, null, null, "offline 1", null)), null),
            new SyncOperation("op-" + Guid.NewGuid().ToString("N"), "income",
                P(new IncomeRequest(w.Id, 50, null, null, null, null, null, "offline 2", null)), null),
        };

        var first = await Push(u, ops);
        Assert.All(first, r => Assert.Equal("applied", r.Status));
        var second = await Push(u, ops); // lost response -> client resends
        Assert.All(second, r => Assert.Equal("duplicate", r.Status));
        Assert.Equal(950m, await u.BalanceAsync(w.Id));
    }

    [Fact]
    public async Task Unapplicable_offline_operation_is_rejected_not_forced()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Offline2", 100);
        var cat = await u.CategoryAsync("Off-cat2");
        var res = await Push(u, [new SyncOperation("op-" + Guid.NewGuid().ToString("N"), "expense",
            P(new ExpenseRequest(w.Id, 500, cat.Id, null, null, null, null, null)), null)]);
        Assert.Equal("rejected", res[0].Status);
        Assert.Equal("wallet.insufficient_funds", res[0].ErrorCode);
        Assert.Equal(100m, await u.BalanceAsync(w.Id));
    }

    [Fact]
    public async Task Pull_returns_catalogs_and_transactions()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Pull", 10);
        await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 5));
        var json = await u.Http.GetFromJsonAsync<JsonElement>("/api/sync/pull");
        Assert.Equal(2, json.GetProperty("transactions").GetArrayLength()); // opening + income
        Assert.Equal(1, json.GetProperty("wallets").GetArrayLength());
        Assert.True(json.GetProperty("categories").GetArrayLength() >= 12);
    }

    private static async Task<List<SyncResult>> Push(ApiUser u, SyncOperation[] ops)
    {
        var res = await u.Http.PostAsJsonAsync("/api/sync/push", new SyncPushRequest(ops));
        res.EnsureSuccessStatusCode();
        var doc = await res.Content.ReadFromJsonAsync<JsonElement>();
        return doc.GetProperty("results").Deserialize<List<SyncResult>>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    // ---- attachments

    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    private static MultipartFormDataContent File(byte[] bytes, string name, string mime)
    {
        var c = new MultipartFormDataContent();
        var f = new ByteArrayContent(bytes);
        f.Headers.ContentType = new MediaTypeHeaderValue(mime);
        c.Add(f, "file", name);
        return c;
    }

    [Fact]
    public async Task Attachment_roundtrip_and_isolation()
    {
        var alice = await app.RegisterAsync();
        var bob = await app.RegisterAsync();
        var w = await alice.WalletAsync("Att", 100);
        var tx = await alice.OkAsync<OperationResult>(await alice.IncomeAsync(w.Id, 10));

        var up = await alice.Http.PostAsync($"/api/transactions/{tx.Transaction.Id}/attachments", File(Png, "chek.png", "image/png"));
        Assert.Equal(HttpStatusCode.Created, up.StatusCode);
        var att = (await up.Content.ReadFromJsonAsync<AttachmentDto>())!;

        var dl = await alice.Http.GetAsync($"/api/transactions/{tx.Transaction.Id}/attachments/{att.Id}");
        Assert.Equal(HttpStatusCode.OK, dl.StatusCode);
        Assert.Equal(Png, await dl.Content.ReadAsByteArrayAsync());

        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.Http.GetAsync($"/api/transactions/{tx.Transaction.Id}/attachments/{att.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.Http.PostAsync($"/api/transactions/{tx.Transaction.Id}/attachments", File(Png, "x.png", "image/png"))).StatusCode);
    }

    [Fact]
    public async Task Dangerous_files_are_rejected_by_content_not_by_name()
    {
        var u = await app.RegisterAsync();
        var w = await u.WalletAsync("Att2", 100);
        var tx = await u.OkAsync<OperationResult>(await u.IncomeAsync(w.Id, 10));
        byte[] exe = [0x4D, 0x5A, 0x90, 0x00, 0x03, 0, 0, 0]; // "MZ" Windows executable
        var res = await u.Http.PostAsync($"/api/transactions/{tx.Transaction.Id}/attachments", File(exe, "virus.png", "image/png"));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, res.StatusCode);
    }

    // ---- demo data

    [Fact]
    public async Task Demo_seed_is_idempotent_and_books_balance()
    {
        await DemoSeeder.SeedAsync(app.Services, "Demo12345!");
        await DemoSeeder.SeedAsync(app.Services, "Demo12345!");

        var client = app.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(DemoSeeder.DemoEmail, "Demo12345!"));
        var auth = (await login.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);

        var rec = await client.GetFromJsonAsync<JsonElement>("/api/reconciliation");
        Assert.True(rec.GetProperty("ok").GetBoolean());
        var wallets = await client.GetFromJsonAsync<List<WalletDto>>("/api/wallets");
        Assert.Equal(6, wallets!.Count);
        var summary = await client.GetFromJsonAsync<JsonElement>("/api/analytics/summary");
        Assert.True(summary.GetProperty("totals").GetArrayLength() >= 1);
    }
}
