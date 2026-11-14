using System.Net.Http.Json;
using System.Net;
using Xunit;

namespace Hamyon.Tests;

/// <summary>The public privacy policy page the stores link to.</summary>
public sealed class PrivacyTests(TestApp app) : IClassFixture<TestApp>
{
    [Theory]
    [InlineData("", "Maxfiylik siyosati")]
    [InlineData("?lang=ru", "Политика конфиденциальности")]
    [InlineData("?lang=en", "Privacy policy")]
    public async Task Privacy_page_is_public_html_in_three_languages(string query, string title)
    {
        var res = await app.CreateClient().GetAsync("/privacy" + query);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/html", res.Content.Headers.ContentType?.MediaType);
        var html = await res.Content.ReadAsStringAsync();
        Assert.Contains(title, html);
        Assert.Contains("hamyon.raqamlinazorat.uz", html);
    }
}

/// <summary>The public account deletion page (store requirement).</summary>
public sealed class DeleteAccountPageTests(TestApp app) : IClassFixture<TestApp>
{
    private static FormUrlEncodedContent Form(string email, string password, bool confirm) => new(new Dictionary<string, string>
    {
        ["lang"] = "en", ["email"] = email, ["password"] = password, ["confirm"] = confirm ? "on" : "",
    });

    [Fact]
    public async Task Wrong_password_keeps_the_account_and_the_right_one_deletes_it_with_its_synced_books()
    {
        Assert.Equal(HttpStatusCode.OK, (await app.CreateClient().GetAsync("/delete-account")).StatusCode);

        var u = await app.RegisterAsync();
        var push = await u.Http.PostAsJsonAsync("/api/books/push", new Hamyon.Api.Endpoints.BookPushRequest("main",
            [new Hamyon.Api.Endpoints.BookDocIn("wallet", "w1", """{"name":"Naqd"}""", DateTimeOffset.UtcNow, false)]));
        push.EnsureSuccessStatusCode();
        var web = app.CreateClient();

        var wrong = await (await web.PostAsync("/delete-account", Form(u.Email, "nope-nope", true))).Content.ReadAsStringAsync();
        Assert.Contains("Wrong email or password", wrong);
        var unconfirmed = await (await web.PostAsync("/delete-account", Form(u.Email, "Passw0rd!x", false))).Content.ReadAsStringAsync();
        Assert.Contains("tick the box", unconfirmed);
        Assert.Equal(HttpStatusCode.OK, (await u.Http.GetAsync("/api/books")).StatusCode); // still there

        var ok = await (await web.PostAsync("/delete-account", Form(u.Email, "Passw0rd!x", true))).Content.ReadAsStringAsync();
        Assert.Contains("have been deleted", ok);
        var login = await web.PostAsJsonAsync("/api/auth/login", new Hamyon.Api.Contracts.LoginRequest(u.Email, "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }
}
