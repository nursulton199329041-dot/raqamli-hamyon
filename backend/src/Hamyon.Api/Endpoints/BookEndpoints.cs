using System.Data;
using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hamyon.Api.Endpoints;

public sealed record BookDocIn(string Kind, string Uid, string Data, DateTimeOffset UpdatedAt, bool Deleted);
public sealed record BookPushRequest(string BookId, IReadOnlyList<BookDocIn> Docs);
public sealed record BookPushResponse(int Accepted, int Stale);
public sealed record BookDocOut(string Kind, string Uid, string Data, DateTimeOffset UpdatedAt, bool Deleted, long Seq);
public sealed record BookPullResponse(IReadOnlyList<BookDocOut> Docs, long Cursor, bool More);
public sealed record BookInfo(string BookId, long Docs, DateTimeOffset LastChange);

/// <summary>
/// Device-book sync for the offline-first client. The phone owns its data; the server keeps one document per row
/// (keyed by the client's stable uid) so every device of the account converges:
/// push = upsert where the incoming change is not older (last writer wins), pull = everything after a cursor.
/// Documents are opaque JSON to the server — it never computes balances from them.
/// </summary>
public static class BookEndpoints
{
    private const int MaxPush = 500;
    private const int PageSize = 1000;
    private static readonly HashSet<string> Kinds = ["meta", "wallet", "source", "category", "operation"];

    public static void MapBooks(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/books").WithTags("Books").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = new List<BookInfo>();
            await using var cmd = await Command(db, """
                SELECT "BookId", count(*), max("UpdatedAt") FROM "BookDocs" WHERE "UserId" = @u GROUP BY "BookId" ORDER BY "BookId"
                """, ct);
            cmd.Parameters.AddWithValue("u", uid);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) list.Add(new BookInfo(r.GetString(0), r.GetInt64(1), r.GetFieldValue<DateTimeOffset>(2)));
            return Results.Ok(list);
        });

        g.MapPost("/push", async (BookPushRequest req, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            Validate(req.BookId, "book");
            if (req.Docs.Count > MaxPush) throw new DomainException("books.too_many", $"At most {MaxPush} documents per push.");
            foreach (var d in req.Docs)
            {
                if (!Kinds.Contains(d.Kind)) throw new DomainException("books.kind", $"Unknown document kind '{d.Kind}'.");
                Validate(d.Uid, "uid");
                if (d.Data.Length > 64_000) throw new DomainException("books.too_large", "Document too large.");
            }

            var accepted = 0;
            await db.Database.OpenConnectionAsync(ct);
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            foreach (var d in req.Docs)
            {
                // a new row, or a change that is not older than the stored one, gets a fresh Seq; older ones are ignored
                await using var cmd = await Command(db, """
                    INSERT INTO "BookDocs" ("UserId", "BookId", "Kind", "Uid", "Data", "UpdatedAt", "Deleted")
                    VALUES (@u, @b, @k, @id, @data, @t, @del)
                    ON CONFLICT ("UserId", "BookId", "Kind", "Uid") DO UPDATE
                      SET "Data" = excluded."Data", "UpdatedAt" = excluded."UpdatedAt", "Deleted" = excluded."Deleted",
                          "Seq" = nextval('"BookDocs_Seq_seq"')
                      WHERE "BookDocs"."UpdatedAt" <= excluded."UpdatedAt"
                    """, ct);
                cmd.Transaction = (NpgsqlTransaction)tx.GetDbTransaction();
                cmd.Parameters.AddWithValue("u", uid);
                cmd.Parameters.AddWithValue("b", req.BookId);
                cmd.Parameters.AddWithValue("k", d.Kind);
                cmd.Parameters.AddWithValue("id", d.Uid);
                cmd.Parameters.AddWithValue("data", d.Data);
                cmd.Parameters.AddWithValue("t", d.UpdatedAt.ToUniversalTime());
                cmd.Parameters.AddWithValue("del", d.Deleted);
                accepted += await cmd.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new BookPushResponse(accepted, req.Docs.Count - accepted));
        });

        g.MapGet("/pull", async (string bookId, long? since, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            Validate(bookId, "book");
            var docs = new List<BookDocOut>();
            await using var cmd = await Command(db, """
                SELECT "Kind", "Uid", "Data", "UpdatedAt", "Deleted", "Seq" FROM "BookDocs"
                WHERE "UserId" = @u AND "BookId" = @b AND "Seq" > @s ORDER BY "Seq" LIMIT @n
                """, ct);
            cmd.Parameters.AddWithValue("u", uid);
            cmd.Parameters.AddWithValue("b", bookId);
            cmd.Parameters.AddWithValue("s", since ?? 0);
            cmd.Parameters.AddWithValue("n", PageSize + 1);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                docs.Add(new BookDocOut(r.GetString(0), r.GetString(1), r.GetString(2), r.GetFieldValue<DateTimeOffset>(3), r.GetBoolean(4), r.GetInt64(5)));
            var more = docs.Count > PageSize;
            if (more) docs.RemoveAt(docs.Count - 1);
            return Results.Ok(new BookPullResponse(docs, docs.Count > 0 ? docs[^1].Seq : since ?? 0, more));
        });
    }

    private static void Validate(string? value, string what)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 64 || value.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')))
            throw new DomainException($"books.{what}", $"Invalid {what} id.");
    }

    private static async Task<NpgsqlCommand> Command(AppDbContext db, string sql, CancellationToken ct)
    {
        var conn = (NpgsqlConnection)db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
        return new NpgsqlCommand(sql, conn);
    }
}
