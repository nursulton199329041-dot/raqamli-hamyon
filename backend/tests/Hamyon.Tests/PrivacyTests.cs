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
