using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Endpoints;

public sealed record ProfileDto(Guid Id, string Name, string Color, string Icon, string BaseCurrency, int SortOrder,
    bool IsArchived, int Revision, bool IsCurrent);
public sealed record ProfileCreateRequest(string Name, string? BaseCurrency, string? Color, string? Icon);
public sealed record ProfileUpdateRequest(string? Name, string? BaseCurrency, string? Color, string? Icon, bool? IsArchived,
    int Revision);

/// <summary>
/// Financial profiles of the signed-in account, and the per-request profile resolution every other endpoint relies on.
/// </summary>
public static class ProfileEndpoints
{
    public const string Header = "X-Profile-Id";
    private const int MaxProfiles = 20;

    /// <summary>
    /// Resolves the request's profile: the <c>X-Profile-Id</c> header when it names an active profile of this account,
    /// else the account's first profile. A header naming anything else is answered with 404 (nothing is revealed).
    /// </summary>
    public static IApplicationBuilder UseProfileScope(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        if (ctx.User.Identity?.IsAuthenticated == true && Guid.TryParse(ctx.User.FindFirst("sub")?.Value, out var uid))
        {
            var db = ctx.RequestServices.GetRequiredService<AppDbContext>();
            var ids = await db.Profiles.AsNoTracking().Where(p => p.UserId == uid && !p.IsArchived)
                .OrderBy(p => p.SortOrder).ThenBy(p => p.CreatedAt).Select(p => p.Id).ToListAsync(ctx.RequestAborted);
            Guid chosen;
            if (ctx.Request.Headers.TryGetValue(Header, out var raw) && !string.IsNullOrWhiteSpace(raw))
            {
                if (!Guid.TryParse(raw.ToString(), out var wanted) || !ids.Contains(wanted))
                    throw new DomainException("profile.not_found", "Profile not found.", 404);
                chosen = wanted;
            }
            else if (ids.Count > 0) chosen = ids[0];
            else
            {
                // safety net for an account without any active profile: give it a fresh main profile
                var p = UserDefaults.AddProfile(db, uid, UserDefaults.MainProfileName);
                await db.SaveChangesAsync(ctx.RequestAborted);
                db.ChangeTracker.Clear();
                chosen = p.Id;
            }
            ctx.RequestServices.GetRequiredService<ProfileScope>().Use(chosen);
        }
        await next();
    });

    public static void MapProfiles(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/profiles").WithTags("Profiles").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var list = await db.Profiles.AsNoTracking().Where(p => p.UserId == uid)
                .OrderBy(p => p.SortOrder).ThenBy(p => p.CreatedAt).ToListAsync(ct);
            return Results.Ok(list.Select(p => Map(p, db.CurrentProfileId)));
        });

        g.MapPost("/", async (ProfileCreateRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var name = CleanName(r.Name);
            var currency = Currency(r.BaseCurrency ?? "UZS");
            var count = await db.Profiles.CountAsync(p => p.UserId == uid, ct);
            if (count >= MaxProfiles) throw new DomainException("profile.limit", $"At most {MaxProfiles} profiles.", 422);
            var p = UserDefaults.AddProfile(db, uid, name, currency, count, Color(r.Color), Icon(r.Icon));
            db.AuditLogs.Add(new AuditLog { UserId = uid, Action = "profile.create", EntityType = "Profile", EntityId = p.Id });
            await db.SaveChangesAsync(ct);
            return Results.Ok(Map(p, db.CurrentProfileId));
        });

        g.MapPatch("/{id:guid}", async (Guid id, ProfileUpdateRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.UserId();
            var p = await db.Profiles.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct)
                    ?? throw new DomainException("profile.not_found", "Profile not found.", 404);
            // optimistic concurrency: an edit made from another device in between is reported, never overwritten
            if (p.Revision != r.Revision)
                throw new DomainException("conflict.stale", "Profile was changed elsewhere; reload and retry.", 409);
            if (r.Name is not null) p.Name = CleanName(r.Name);
            if (r.BaseCurrency is not null) p.BaseCurrency = Currency(r.BaseCurrency);
            if (r.Color is not null) p.Color = Color(r.Color);
            if (r.Icon is not null) p.Icon = Icon(r.Icon);
            if (r.IsArchived is { } archived && archived != p.IsArchived)
            {
                if (archived && !await db.Profiles.AnyAsync(x => x.UserId == uid && x.Id != id && !x.IsArchived, ct))
                    throw new DomainException("profile.last_active", "The last active profile cannot be archived.", 409);
                p.IsArchived = archived;
            }
            p.Revision++;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                throw new DomainException("conflict.stale", "Profile was changed elsewhere; reload and retry.", 409);
            }
            return Results.Ok(Map(p, db.CurrentProfileId));
        });
    }

    private static ProfileDto Map(Profile p, Guid current) =>
        new(p.Id, p.Name, p.Color, p.Icon, p.BaseCurrency, p.SortOrder, p.IsArchived, p.Revision, p.Id == current);

    private static string CleanName(string? name)
    {
        var n = name?.Trim() ?? "";
        if (n.Length is 0 or > 60) throw new DomainException("profile.name", "Profile name must be 1-60 characters.");
        return n;
    }

    private static string Currency(string c)
    {
        var cur = Currencies.Normalize(c);
        if (!Currencies.IsSupported(cur)) throw new DomainException("currency.unsupported", $"Unsupported currency '{cur}'.");
        return cur;
    }

    private static string Color(string? c) =>
        c is null ? "#4D8DFF" : System.Text.RegularExpressions.Regex.IsMatch(c, "^#[0-9a-fA-F]{6}$") ? c
            : throw new DomainException("profile.color", "Color must be #RRGGBB.");

    private static string Icon(string? i) =>
        i is null ? "person" : i.Length is > 0 and <= 40 ? i : throw new DomainException("profile.icon", "Invalid icon.");
}
