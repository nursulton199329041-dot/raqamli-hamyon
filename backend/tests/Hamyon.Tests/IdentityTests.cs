using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Hamyon.Api.Auth;
using Hamyon.Api.Contracts;
using Hamyon.Domain;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Hamyon.Tests;

/// <summary>V6 Phase 4: Google sign-in, linking, and a device's guest book uploaded as its own profile.</summary>
public sealed class IdentityTests(TestApp app) : IClassFixture<TestApp>
{
    /// <summary>Stands in for Google: token "sub|email|verified|name". Signature checks are GoogleTokenValidator's job.</summary>
    private sealed class FakeGoogle : IExternalTokenValidator
    {
        public Task<ExternalIdentity> ValidateAsync(string idToken, CancellationToken ct)
        {
            var p = idToken.Split('|');
            if (p.Length != 4) throw new DomainException("auth.google_invalid", "Google sign-in failed.", 401);
            return Task.FromResult(new ExternalIdentity(GoogleTokenValidator.Issuer, p[0], p[1], p[2] == "1", p[3]));
        }
    }

    private HttpClient Client() =>
        app.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IExternalTokenValidator, FakeGoogle>())).CreateClient();

    /// <summary>A client of the Google-enabled host signed in with the password (tokens are per host).</summary>
    private async Task<HttpClient> SignedInAsync(ApiUser u)
    {
        var http = Client();
        var auth = await (await http.PostAsJsonAsync("/api/auth/login", new { email = u.Email, password = "Passw0rd!x" }))
            .Content.ReadFromJsonAsync<AuthResponse>();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return http;
    }

    private static string Token(string sub, string email, bool verified = true) => $"{sub}|{email}|{(verified ? 1 : 0)}|Google User";

    [Fact]
    public async Task Google_sign_in_opens_one_account_per_identity_and_signs_it_in_again()
    {
        var http = Client();
        var sub = Guid.NewGuid().ToString("N");
        var email = $"g{sub}@gmail.test";
        var first = await (await http.PostAsJsonAsync("/api/auth/google", new { idToken = Token(sub, email), locale = "ru" }))
            .Content.ReadFromJsonAsync<AuthResponse>();
        var again = await (await http.PostAsJsonAsync("/api/auth/google", new { idToken = Token(sub, email) }))
            .Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(first!.User.Id, again!.User.Id);
        Assert.Equal("ru", first.User.Locale);

        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", again.AccessToken);
        var profiles = await http.GetFromJsonAsync<JsonElement>("/api/profiles");
        Assert.Equal(1, profiles.GetArrayLength());

        // no password exists for a Google account: password login never succeeds
        var pw = await Client().PostAsJsonAsync("/api/auth/login", new { email, password = "" });
        Assert.Equal(HttpStatusCode.BadRequest, pw.StatusCode);
        var pw2 = await Client().PostAsJsonAsync("/api/auth/login", new { email, password = "anything-1" });
        Assert.Equal(HttpStatusCode.Unauthorized, pw2.StatusCode);

        // an unverified email never opens an account
        var unverified = await Client().PostAsJsonAsync("/api/auth/google", new { idToken = Token(Guid.NewGuid().ToString("N"), $"x{sub}@gmail.test", false) });
        Assert.Equal(HttpStatusCode.Unauthorized, unverified.StatusCode);
        var junk = await Client().PostAsJsonAsync("/api/auth/google", new { idToken = "garbage" });
        Assert.Equal(HttpStatusCode.Unauthorized, junk.StatusCode);
    }

    [Fact]
    public async Task An_existing_email_is_never_taken_over_it_is_linked_by_its_owner()
    {
        var owner = await app.RegisterAsync();
        var sub = Guid.NewGuid().ToString("N");

        var takeover = await Client().PostAsJsonAsync("/api/auth/google", new { idToken = Token(sub, owner.Email) });
        var err = await owner.ErrorAsync(takeover, HttpStatusCode.Conflict);
        Assert.Equal("auth.link_required", err.Code);

        var link = await SignedInAsync(owner);
        (await link.PostAsJsonAsync("/api/me/google", new { idToken = Token(sub, owner.Email) })).EnsureSuccessStatusCode();
        (await link.PostAsJsonAsync("/api/me/google", new { idToken = Token(sub, owner.Email) })).EnsureSuccessStatusCode(); // repeat is fine

        var signIn = await (await Client().PostAsJsonAsync("/api/auth/google", new { idToken = Token(sub, owner.Email) }))
            .Content.ReadFromJsonAsync<AuthResponse>();
        Assert.Equal(owner.Id, signIn!.User.Id);

        // the same Google identity can't be attached to a second user, and a linked user can't attach another one
        var other = await app.RegisterAsync();
        var steal = await SignedInAsync(other);
        Assert.Equal("auth.identity_taken",
            (await other.ErrorAsync(await steal.PostAsJsonAsync("/api/me/google", new { idToken = Token(sub, other.Email) }), HttpStatusCode.Conflict)).Code);
        Assert.Equal("auth.already_linked",
            (await owner.ErrorAsync(await link.PostAsJsonAsync("/api/me/google", new { idToken = Token(Guid.NewGuid().ToString("N"), owner.Email) }), HttpStatusCode.Conflict)).Code);
    }

    [Fact]
    public async Task Google_is_off_until_client_ids_are_configured()
    {
        var res = await app.CreateClient().PostAsJsonAsync("/api/auth/google", new { idToken = "a.b.c" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Contains("auth.google_disabled", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_guest_book_is_uploaded_as_its_own_profile_with_the_device_ids()
    {
        var u = await app.RegisterAsync();
        var guest = Guid.NewGuid();
        var created = await u.OkAsync<JsonElement>(await u.Http.PostAsJsonAsync("/api/profiles",
            new { id = guest, name = "Telefon", baseCurrency = "UZS", seedDefaults = false }));
        Assert.Equal(guest, created.GetProperty("id").GetGuid());
        // repeating the call (lost response) returns the same profile instead of a second one
        (await u.Http.PostAsJsonAsync("/api/profiles", new { id = guest, name = "Telefon", seedDefaults = false })).EnsureSuccessStatusCode();
        Assert.Equal(2, (await u.Http.GetFromJsonAsync<JsonElement>("/api/profiles")).GetArrayLength());

        // the device's own catalog and operations land in that profile; the main profile is untouched
        var cat = Guid.NewGuid();
        var wallet = Guid.NewGuid();
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/sync/push")
        {
            Content = JsonContent.Create(new
            {
                operations = new object[]
                {
                    new { clientOperationId = $"category:{cat}", kind = "category.create", payload = new { id = cat, name = "Oziq-ovqat" } },
                    new { clientOperationId = $"wallet:{wallet}", kind = "wallet.create", payload = new { id = wallet, openingId = Guid.NewGuid(), openedAt = "2026-09-01T08:00:00Z", name = "Naqd", type = 0, currency = "UZS", initialBalance = 50_000m } },
                    new { clientOperationId = Guid.NewGuid().ToString(), kind = "expense", payload = new { id = Guid.NewGuid(), walletId = wallet, categoryId = cat, amount = 20_000m } },
                },
            }),
        };
        req.Headers.Add("X-Profile-Id", guest.ToString());
        var results = (await u.OkAsync<JsonElement>(await u.Http.SendAsync(req))).GetProperty("results").EnumerateArray().ToList();
        Assert.All(results, r => Assert.Equal("applied", r.GetProperty("status").GetString()));

        var pullGuest = new HttpRequestMessage(HttpMethod.Get, "/api/sync/pull");
        pullGuest.Headers.Add("X-Profile-Id", guest.ToString());
        var g = await u.OkAsync<JsonElement>(await u.Http.SendAsync(pullGuest));
        Assert.Equal(1, g.GetProperty("categories").GetArrayLength()); // no default catalog was added on top
        Assert.Equal(30_000m, g.GetProperty("wallets")[0].GetProperty("balance").GetDecimal());
        // the opening keeps the date the wallet was opened on the device, not the upload time
        var opening = g.GetProperty("transactions").EnumerateArray().Single(t => t.GetProperty("type").GetInt32() == 0);
        Assert.Equal(new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero), opening.GetProperty("occurredAt").GetDateTimeOffset());
        var main = await u.Http.GetFromJsonAsync<JsonElement>("/api/sync/pull");
        Assert.Equal(0, main.GetProperty("wallets").GetArrayLength());

        // another account can't claim that id
        var other = await app.RegisterAsync();
        var res = await other.Http.PostAsJsonAsync("/api/profiles", new { id = guest, name = "X", seedDefaults = false });
        Assert.Equal("profile.id_taken", (await other.ErrorAsync(res, HttpStatusCode.Conflict)).Code);
    }
}
