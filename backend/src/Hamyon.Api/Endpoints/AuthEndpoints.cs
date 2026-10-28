using Hamyon.Api.Auth;
using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hamyon.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuth(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/auth").WithTags("Auth").RequireRateLimiting("auth");

        g.MapPost("/register", async (RegisterRequest r, AuthService auth, CancellationToken ct) =>
            Results.Ok(await auth.RegisterAsync(r, ct))).Validate<RegisterRequest>();

        g.MapPost("/login", async (LoginRequest r, AuthService auth, HttpContext ctx, CancellationToken ct) =>
            Results.Ok(await auth.LoginAsync(r, ctx.Connection.RemoteIpAddress?.ToString(), ct))).Validate<LoginRequest>();

        g.MapPost("/google", async (ExternalSignInRequest r, IExternalTokenValidator google, AuthService auth, HttpContext ctx, CancellationToken ct) =>
            Results.Ok(await auth.ExternalSignInAsync(await google.ValidateAsync(r.IdToken, ct), r.Locale,
                ctx.Connection.RemoteIpAddress?.ToString(), ct)));

        g.MapPost("/refresh", async (RefreshRequest r, AuthService auth, CancellationToken ct) =>
            Results.Ok(await auth.RefreshAsync(r.RefreshToken, ct)));

        g.MapPost("/logout", async (RefreshRequest r, AuthService auth, CancellationToken ct) =>
        {
            await auth.LogoutAsync(r.RefreshToken, ct);
            return Results.NoContent();
        });

        var me = app.MapGroup("/api/me").WithTags("Profile").RequireAuthorization();

        me.MapGet("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var id = ctx.User.UserId();
            var u = await db.Users.AsNoTracking().FirstAsync(x => x.Id == id, ct);
            return Results.Ok(AuthService.ToDto(u));
        });

        // links Google to an account that signed in another way (email + password)
        me.MapPost("/google", async (ExternalSignInRequest r, IExternalTokenValidator google, AuthService auth, HttpContext ctx, CancellationToken ct) =>
            Results.Ok(await auth.LinkExternalAsync(ctx.User.UserId(), await google.ValidateAsync(r.IdToken, ct), ct)))
            .RequireRateLimiting("auth");

        me.MapPatch("/", async (UpdateProfileRequest r, HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var id = ctx.User.UserId();
            var u = await db.Users.FirstAsync(x => x.Id == id, ct);
            if (r.DisplayName is { Length: > 0 }) u.DisplayName = r.DisplayName.Trim()[..Math.Min(100, r.DisplayName.Trim().Length)];
            if (r.Locale is "uz" or "ru" or "en") u.Locale = r.Locale;
            if (r.Theme is "light" or "dark" or "system") u.Theme = r.Theme;
            if (r.DefaultCurrency is not null)
            {
                var c = Currencies.Normalize(r.DefaultCurrency);
                if (!Currencies.IsSupported(c)) throw new DomainException("currency.unsupported", "Unsupported currency.");
                u.DefaultCurrency = c;
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(AuthService.ToDto(u));
        });

        // Right to erasure: removes the profile and every record owned by the user.
        me.MapDelete("/", async (HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        {
            var id = ctx.User.UserId();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            // every profile of the account, not just the one this request is scoped to
            await db.Attachments.IgnoreQueryFilters().Where(a => a.UserId == id).ExecuteDeleteAsync(ct);
            await db.LedgerLines.IgnoreQueryFilters().Where(l => l.UserId == id).ExecuteDeleteAsync(ct);
            await db.JournalEntries.IgnoreQueryFilters().Where(e => e.UserId == id).ExecuteDeleteAsync(ct);
            await db.Debts.IgnoreQueryFilters().Where(d => d.UserId == id).ExecuteDeleteAsync(ct);
            await db.Wallets.IgnoreQueryFilters().Where(w => w.UserId == id).ExecuteDeleteAsync(ct);
            await db.LedgerAccounts.IgnoreQueryFilters().Where(a => a.UserId == id).ExecuteDeleteAsync(ct);
            await db.Categories.IgnoreQueryFilters().Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
            await db.IncomeSources.IgnoreQueryFilters().Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
            await db.People.IgnoreQueryFilters().Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
            await db.Projects.IgnoreQueryFilters().Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
            await db.Profiles.Where(p => p.UserId == id).ExecuteDeleteAsync(ct);
            await db.RefreshTokens.Where(t => t.UserId == id).ExecuteDeleteAsync(ct);
            await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(ct);
            db.AuditLogs.Add(new AuditLog { Action = "user.delete", EntityType = "User", EntityId = id });
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.NoContent();
        });
    }
}
