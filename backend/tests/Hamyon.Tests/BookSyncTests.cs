using System.Net;
using System.Net.Http.Json;
using Hamyon.Api.Endpoints;
using Xunit;

namespace Hamyon.Tests;

/// <summary>Device-book sync (/api/books): last writer wins, cursor pulls, tombstones, per-account isolation.</summary>
public sealed class BookSyncTests(TestApp app) : IClassFixture<TestApp>
{
    private static BookDocIn Doc(string uid, string data, DateTimeOffset at, bool deleted = false, string kind = "wallet") =>
        new(kind, uid, data, at, deleted);

    [Fact]
    public async Task Push_then_pull_returns_every_document_after_the_cursor()
    {
        var u = await app.RegisterAsync();
        var t = DateTimeOffset.UtcNow;
        var push = await u.Http.PostAsJsonAsync("/api/books/push", new BookPushRequest("main",
            [Doc("w1", """{"name":"Naqd"}""", t), Doc("op1", """{"amount":5}""", t, kind: "operation")]));
        Assert.Equal(HttpStatusCode.OK, push.StatusCode);
        Assert.Equal(2, (await push.Content.ReadFromJsonAsync<BookPushResponse>())!.Accepted);

        var all = await u.Http.GetFromJsonAsync<BookPullResponse>("/api/books/pull?bookId=main");
        Assert.Equal(2, all!.Docs.Count);
        Assert.False(all.More);

        // nothing new after the cursor
        var none = await u.Http.GetFromJsonAsync<BookPullResponse>($"/api/books/pull?bookId=main&since={all.Cursor}");
        Assert.Empty(none!.Docs);
        Assert.Equal(all.Cursor, none.Cursor);

        var books = await u.Http.GetFromJsonAsync<List<BookInfo>>("/api/books");
        Assert.Equal("main", Assert.Single(books!).BookId);
    }

    [Fact]
    public async Task Last_writer_wins_and_an_older_change_is_ignored()
    {
        var u = await app.RegisterAsync();
        var t = DateTimeOffset.UtcNow;
        await u.Http.PostAsJsonAsync("/api/books/push", new BookPushRequest("main", [Doc("w1", """{"name":"A"}""", t)]));
        var first = await u.Http.GetFromJsonAsync<BookPullResponse>("/api/books/pull?bookId=main");

        // a phone that was offline sends an older edit: ignored
        var stale = await (await u.Http.PostAsJsonAsync("/api/books/push",
            new BookPushRequest("main", [Doc("w1", """{"name":"OLD"}""", t.AddMinutes(-5))]))).Content.ReadFromJsonAsync<BookPushResponse>();
        Assert.Equal(1, stale!.Stale);

        // a newer edit and a delete win, and show up after the cursor
        await u.Http.PostAsJsonAsync("/api/books/push", new BookPushRequest("main", [Doc("w1", """{"name":"B"}""", t.AddMinutes(1), deleted: true)]));
        var next = await u.Http.GetFromJsonAsync<BookPullResponse>($"/api/books/pull?bookId=main&since={first!.Cursor}");
        var d = Assert.Single(next!.Docs);
        Assert.Equal("""{"name":"B"}""", d.Data);
        Assert.True(d.Deleted);
    }

    [Fact]
    public async Task Accounts_and_books_are_isolated()
    {
        var a = await app.RegisterAsync();
        var b = await app.RegisterAsync();
        var t = DateTimeOffset.UtcNow;
        await a.Http.PostAsJsonAsync("/api/books/push", new BookPushRequest("main", [Doc("w1", "{}", t)]));
        await a.Http.PostAsJsonAsync("/api/books/push", new BookPushRequest("family", [Doc("w9", "{}", t)]));

        Assert.Empty((await b.Http.GetFromJsonAsync<BookPullResponse>("/api/books/pull?bookId=main"))!.Docs);
        Assert.Single((await a.Http.GetFromJsonAsync<BookPullResponse>("/api/books/pull?bookId=family"))!.Docs);
        Assert.Equal(2, (await a.Http.GetFromJsonAsync<List<BookInfo>>("/api/books"))!.Count);
    }

    [Fact]
    public async Task Bad_input_is_rejected_and_anonymous_calls_are_refused()
    {
        var u = await app.RegisterAsync();
        var t = DateTimeOffset.UtcNow;
        Assert.Equal(HttpStatusCode.BadRequest, (await u.Http.PostAsJsonAsync("/api/books/push",
            new BookPushRequest("main", [Doc("w1", "{}", t, kind: "virus")]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await u.Http.PostAsJsonAsync("/api/books/push",
            new BookPushRequest("../etc", [Doc("w1", "{}", t)]))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.CreateClient().GetAsync("/api/books/pull?bookId=main")).StatusCode);
    }
}
