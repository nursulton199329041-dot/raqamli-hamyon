using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Hamyon.App.Data;
using Hamyon.App.Models;
using Hamyon.App.Services;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Hamyon.App.Tests;

/// <summary>
/// In-memory stand-in for hamyon.raqamlinazorat.uz with the same rules as the real /api/books (tested on the server
/// side): last writer wins by change time, a growing Seq per accepted change, pulls after a cursor.
/// </summary>
internal sealed class FakeServer : HttpMessageHandler
{
    private sealed class Doc { public string Data = ""; public string At = ""; public bool Deleted; public long Seq; }
    private readonly Dictionary<(string Book, string Kind, string Uid), Doc> _docs = new();
    private long _seq;
    public int Refreshes;
    public bool Offline;
    public bool ExpireTokens;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        if (Offline) throw new HttpRequestException("no network");
        var path = req.RequestUri!.AbsolutePath;
        var body = req.Content is null ? null : JsonNode.Parse(await req.Content.ReadAsStringAsync(ct));
        lock (_docs)
        {
            switch (path)
            {
                case "/api/auth/login" when (string?)body!["password"] == "wrong":
                    return Json(401, new JsonObject { ["code"] = "auth.invalid_credentials", ["message"] = "Invalid email or password." });
                case "/api/auth/login" or "/api/auth/register":
                    return Json(200, Session((string)body!["email"]!));
                case "/api/auth/refresh":
                    Refreshes++;
                    ExpireTokens = false;
                    return Json(200, Session("user@test.uz"));
                case "/api/auth/logout":
                    return Json(204, null);
            }
            if (req.Headers.Authorization?.Parameter != "access" || ExpireTokens)
                return Json(401, new JsonObject { ["code"] = "auth.unauthorized", ["message"] = "Unauthorized." });
            switch (path)
            {
                case "/api/books":
                    return Json(200, new JsonArray(_docs.Keys.Select(k => k.Book).Distinct()
                        .Select(b => (JsonNode)new JsonObject { ["bookId"] = b }).ToArray()));
                case "/api/books/push":
                    var book = (string)body!["bookId"]!;
                    foreach (var d in body["docs"]!.AsArray().OfType<JsonObject>())
                    {
                        var key = (book, (string)d["kind"]!, (string)d["uid"]!);
                        var at = (string)d["updatedAt"]!;
                        if (_docs.TryGetValue(key, out var old) && string.CompareOrdinal(old.At, at) > 0) continue;
                        _docs[key] = new Doc { Data = (string)d["data"]!, At = at, Deleted = (bool)d["deleted"]!, Seq = ++_seq };
                    }
                    return Json(200, new JsonObject { ["accepted"] = 0, ["stale"] = 0 });
                case "/api/books/pull":
                    var q = System.Web.HttpUtility.ParseQueryString(req.RequestUri.Query);
                    var since = long.Parse(q["since"] ?? "0");
                    var list = _docs.Where(kv => kv.Key.Book == q["bookId"] && kv.Value.Seq > since).OrderBy(kv => kv.Value.Seq).ToList();
                    return Json(200, new JsonObject
                    {
                        ["docs"] = new JsonArray(list.Select(kv => (JsonNode)new JsonObject
                        {
                            ["kind"] = kv.Key.Kind, ["uid"] = kv.Key.Uid, ["data"] = kv.Value.Data,
                            ["updatedAt"] = kv.Value.At, ["deleted"] = kv.Value.Deleted, ["seq"] = kv.Value.Seq,
                        }).ToArray()),
                        ["cursor"] = list.Count > 0 ? list[^1].Value.Seq : since,
                        ["more"] = false,
                    });
            }
        }
        return Json(404, null);
    }

    private static JsonObject Session(string email) => new()
    {
        ["accessToken"] = "access", ["refreshToken"] = "refresh", ["accessExpiresAt"] = DateTimeOffset.UtcNow.AddMinutes(15).ToString("o"),
        ["user"] = new JsonObject { ["id"] = "u1", ["email"] = email },
    };

    private static HttpResponseMessage Json(int status, JsonNode? body) =>
        new((HttpStatusCode)status) { Content = new StringContent(body?.ToJsonString() ?? "", Encoding.UTF8, "application/json") };
}

/// <summary>One phone: its own profile index + books folder, talking to the shared fake server.</summary>
internal sealed class Phone : IDisposable
{
    public readonly string Dir = Path.Combine(Path.GetTempPath(), $"hamyon-phone-{Guid.NewGuid():N}");
    public readonly ProfileStore Profiles;
    public readonly Account Account;
    public readonly SyncEngine Sync;

    public Phone(FakeServer server)
    {
        Profiles = new ProfileStore(Dir);
        Account = new Account(Profiles.GetPref, Profiles.SetPref, server, "https://test.local");
        Sync = new SyncEngine(Account, Profiles);
    }

    public LocalStore Book(string id = ProfileStore.MainId) => new(Profiles.PathOf(id));

    public async Task SignInAsync()
    {
        await Account.LoginAsync("user@test.uz", "secret-123");
        Sync.ResetForNewSession();
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(Dir, true); } catch (IOException) { }
    }
}

public sealed class SyncTests : IDisposable
{
    private readonly FakeServer _server = new();
    private readonly Phone _a, _b;

    public SyncTests()
    {
        _a = new Phone(_server);
        _b = new Phone(_server);
    }

    public void Dispose()
    {
        _a.Dispose();
        _b.Dispose();
    }

    private static Operation Income(LocalStore s, decimal amount, string? note = null) =>
        new(0, OpKind.Income, amount, "UZS", s.Wallets()[0].Id, null, null, s.Sources()[0].Id, null, DateTime.Now, note);

    [Fact]
    public async Task Operations_made_on_one_phone_appear_on_the_other()
    {
        await _a.SignInAsync();
        await _b.SignInAsync();
        var a = _a.Book();
        a.AddOperation(Income(a, 1_000_000m, "oylik"));
        var food = a.Categories()[0];
        a.AddOperation(new Operation(0, OpKind.Expense, 250_000m, "UZS", a.Wallets()[0].Id, null, null, null, food.Id, DateTime.Now, null));

        await _a.Sync.SyncAllAsync();
        var report = await _b.Sync.SyncAllAsync();

        var b = _b.Book();
        Assert.True(report.Pulled >= 2);
        Assert.Equal(750_000m, b.Wallets()[0].Balance);
        Assert.Contains(b.Operations(DateTime.MinValue, DateTime.MaxValue.AddDays(-1)), o => o.Note == "oylik" && o.SourceName == "Ish haqi");
        Assert.Equal(3, b.Wallets().Count); // the default catalog merged, not duplicated
        Assert.DoesNotContain(b.PendingChanges(), d => d.Kind == "operation"); // nothing bounces back
    }

    [Fact]
    public async Task Deletes_and_renames_travel_and_the_later_change_wins()
    {
        await _a.SignInAsync();
        await _b.SignInAsync();
        var a = _a.Book();
        a.AddOperation(Income(a, 500m, "x"));
        await _a.Sync.SyncAllAsync();
        await _b.Sync.SyncAllAsync();

        // B deletes it, A renames the cash wallet a bit later
        var b = _b.Book();
        b.DeleteOperation(b.Operations(DateTime.MinValue, DateTime.MaxValue.AddDays(-1)).Single().Id);
        await Task.Delay(20);
        a.UpdateWallet(a.Wallets()[0].Id, "Cho'ntak", "cash", "#1FCB8B");
        await _b.Sync.SyncAllAsync();
        await _a.Sync.SyncAllAsync();
        await _b.Sync.SyncAllAsync();

        Assert.Empty(a.Operations(DateTime.MinValue, DateTime.MaxValue.AddDays(-1)));
        Assert.Equal("Cho'ntak", b.Wallets()[0].Name);

        // both edit the same wallet: the later edit wins on both phones
        b.UpdateWallet(b.Wallets()[0].Id, "B nomi", "cash", "#1FCB8B");
        await Task.Delay(20);
        a.UpdateWallet(a.Wallets()[0].Id, "A nomi", "cash", "#1FCB8B");
        await _b.Sync.SyncAllAsync();
        await _a.Sync.SyncAllAsync();
        await _b.Sync.SyncAllAsync();
        Assert.Equal("A nomi", a.Wallets()[0].Name);
        Assert.Equal("A nomi", b.Wallets()[0].Name);
    }

    [Fact]
    public async Task Profiles_made_on_one_phone_appear_on_the_other_with_their_data()
    {
        await _a.SignInAsync();
        var family = _a.Profiles.Create("Oila", "#EC4899");
        var book = _a.Book(family.Id);
        book.AddOperation(Income(book, 42_000m));
        await _a.Sync.SyncAllAsync();

        await _b.SignInAsync();
        var report = await _b.Sync.SyncAllAsync();
        Assert.Equal(1, report.NewProfiles);
        var adopted = Assert.Single(_b.Profiles.Items(), p => p.Id == family.Id);
        Assert.Equal("Oila", adopted.Name);
        Assert.Equal(42_000m, _b.Book(family.Id).Wallets()[0].Balance);

        // renaming the profile on B reaches A
        _b.Profiles.Update(family.Id, "Oilaviy", "#3B82F6");
        await _b.Sync.SyncAllAsync();
        await _a.Sync.SyncAllAsync();
        Assert.Equal("Oilaviy", _a.Profiles.Items().Single(p => p.Id == family.Id).Name);
    }

    [Fact]
    public async Task Offline_changes_wait_and_go_up_later()
    {
        await _a.SignInAsync();
        var a = _a.Book();
        a.AddOperation(Income(a, 7m));
        _server.Offline = true;
        await Assert.ThrowsAsync<HttpRequestException>(() => _a.Sync.SyncAllAsync());
        Assert.Contains(a.PendingChanges(), d => d.Kind == "operation"); // still queued

        _server.Offline = false;
        await _a.Sync.SyncAllAsync();
        Assert.DoesNotContain(a.PendingChanges(), d => d.Kind == "operation");

        await _b.SignInAsync();
        await _b.Sync.SyncAllAsync();
        Assert.Equal(7m, _b.Book().Wallets()[0].Balance);
    }

    [Fact]
    public async Task Expired_access_token_is_refreshed_and_bad_password_is_reported()
    {
        var ex = await Assert.ThrowsAsync<ApiException>(() => _a.Account.LoginAsync("user@test.uz", "wrong"));
        Assert.Equal("auth.invalid_credentials", ex.Code);
        Assert.False(_a.Account.SignedIn);

        await _a.SignInAsync();
        _server.ExpireTokens = true;
        await _a.Sync.SyncAllAsync();
        Assert.Equal(1, _server.Refreshes);

        var signedOut = false;
        _a.Account.SignedOut += () => signedOut = true;
        await _a.Account.LogoutAsync();
        Assert.True(signedOut);
        Assert.False(_a.Account.SignedIn);
        Assert.Equal("user@test.uz", _a.Account.Email); // remembered for the next sign-in
    }

    [Fact]
    public async Task Converted_dollar_expense_keeps_its_som_value_on_the_other_phone()
    {
        await _a.SignInAsync();
        await _b.SignInAsync();
        var a = _a.Book();
        var usd = a.Wallets().Single(w => w.Currency == "USD");
        a.AddOperation(new Operation(0, OpKind.Income, 100m, "USD", usd.Id, null, null, a.Sources()[0].Id, null, DateTime.Now, null));
        a.AddOperation(new Operation(0, OpKind.Expense, 20m, "USD", usd.Id, null, null, null, a.Categories()[0].Id, DateTime.Now, null,
            BaseAmount: 256_000m, Rate: 12_800m));
        await _a.Sync.SyncAllAsync();
        await _b.Sync.SyncAllAsync();

        var b = _b.Book();
        Assert.Equal(80m, b.Wallets().Single(w => w.Currency == "USD").Balance);
        var exp = b.Operations(DateTime.MinValue, DateTime.MaxValue.AddDays(-1)).Single(o => o.Kind == OpKind.Expense);
        Assert.Equal(256_000m, exp.BaseAmount);
        Assert.Equal(12_800m, exp.Rate);
    }
}
