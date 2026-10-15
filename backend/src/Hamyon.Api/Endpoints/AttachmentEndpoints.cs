using System.Security.Cryptography;
using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Endpoints;

public sealed record AttachmentDto(Guid Id, string FileName, string ContentType, long Size, DateTimeOffset CreatedAt);

/// <summary>Receipts / documents. Allow-list by real content (magic bytes), size cap, random storage names.</summary>
public static class AttachmentEndpoints
{
    private const long MaxBytes = 10 * 1024 * 1024;
    private const int MaxPerEntry = 10;

    private static readonly (string Mime, string Ext, byte[] Magic)[] Allowed =
    [
        ("image/jpeg", ".jpg", [0xFF, 0xD8, 0xFF]),
        ("image/png", ".png", [0x89, 0x50, 0x4E, 0x47]),
        ("application/pdf", ".pdf", [0x25, 0x50, 0x44, 0x46]),
        ("image/webp", ".webp", [0x52, 0x49, 0x46, 0x46]), // RIFF....WEBP verified below
    ];

    public static void MapAttachments(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/transactions/{id:guid}/attachments").WithTags("Attachments").RequireAuthorization();

        g.MapGet("/", async (Guid id, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = await db.Attachments.AsNoTracking().Where(a => a.UserId == uid && a.JournalEntryId == id)
                .OrderBy(a => a.CreatedAt).ToListAsync(ct);
            return Results.Ok(list.Select(a => new AttachmentDto(a.Id, a.FileName, a.ContentType, a.Size, a.CreatedAt)));
        });

        g.MapPost("/", async (Guid id, IFormFile file, HttpContext ctx, AppDbContext db, IConfiguration cfg, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            if (!await db.JournalEntries.AnyAsync(e => e.Id == id && e.UserId == uid, ct)) throw new NotFoundException("Transaction");
            if (await db.Attachments.CountAsync(a => a.JournalEntryId == id, ct) >= MaxPerEntry)
                throw new DomainException("attachment.limit", $"At most {MaxPerEntry} files per transaction.");
            if (file.Length is <= 0 or > MaxBytes)
                throw new DomainException("attachment.size", "File must be between 1 byte and 10 MB.", 413);

            await using var input = file.OpenReadStream();
            using var buffer = new MemoryStream();
            await input.CopyToAsync(buffer, ct);
            var bytes = buffer.ToArray();

            var kind = Allowed.FirstOrDefault(a => bytes.AsSpan().StartsWith(a.Magic));
            if (kind.Mime is null || (kind.Mime == "image/webp" && !(bytes.Length > 12 && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8))))
                throw new DomainException("attachment.type", "Only JPEG, PNG, WebP images and PDF documents are allowed.", 415);

            var root = cfg["Storage:Path"] ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var userDir = Path.Combine(root, uid.ToString("N"));
            Directory.CreateDirectory(userDir);
            var storageKey = $"{Guid.NewGuid():N}{kind.Ext}";
            await File.WriteAllBytesAsync(Path.Combine(userDir, storageKey), bytes, ct);

            var safeName = Path.GetFileName(file.FileName);
            if (string.IsNullOrWhiteSpace(safeName)) safeName = "file" + kind.Ext;
            var att = new Attachment
            {
                UserId = uid, JournalEntryId = id, FileName = safeName.Length > 200 ? safeName[^200..] : safeName,
                ContentType = kind.Mime, Size = bytes.Length, StorageKey = storageKey,
                Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            };
            db.Attachments.Add(att);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/transactions/{id}/attachments/{att.Id}",
                new AttachmentDto(att.Id, att.FileName, att.ContentType, att.Size, att.CreatedAt));
        }).DisableAntiforgery();

        g.MapGet("/{attId:guid}", async (Guid id, Guid attId, HttpContext ctx, AppDbContext db, IConfiguration cfg, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var a = await db.Attachments.AsNoTracking()
                        .FirstOrDefaultAsync(x => x.Id == attId && x.JournalEntryId == id && x.UserId == uid, ct)
                    ?? throw new NotFoundException("Attachment");
            var root = cfg["Storage:Path"] ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var path = Path.Combine(root, uid.ToString("N"), a.StorageKey);
            if (!File.Exists(path)) throw new NotFoundException("Attachment file");
            ctx.Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
            return Results.File(path, a.ContentType, a.FileName);
        });

        g.MapDelete("/{attId:guid}", async (Guid id, Guid attId, HttpContext ctx, AppDbContext db, IConfiguration cfg, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var a = await db.Attachments.FirstOrDefaultAsync(x => x.Id == attId && x.JournalEntryId == id && x.UserId == uid, ct)
                    ?? throw new NotFoundException("Attachment");
            var root = cfg["Storage:Path"] ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var path = Path.Combine(root, uid.ToString("N"), a.StorageKey);
            db.Attachments.Remove(a);
            db.AuditLogs.Add(new AuditLog { UserId = uid, Action = "attachment.delete", EntityType = "Attachment", EntityId = a.Id });
            await db.SaveChangesAsync(ct);
            if (File.Exists(path)) File.Delete(path);
            return Results.NoContent();
        });
    }
}
