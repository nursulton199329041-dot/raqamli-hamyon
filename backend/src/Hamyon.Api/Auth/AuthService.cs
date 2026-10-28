using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Hamyon.Api.Auth;

public sealed class JwtOptions
{
    public string Issuer { get; set; } = "raqamli-hamyon";
    public string Audience { get; set; } = "raqamli-hamyon-app";
    /// <summary>Signing secret (>= 32 bytes). Supplied via environment/user-secrets, never committed.</summary>
    public string Secret { get; set; } = "";
    public int AccessMinutes { get; set; } = 15;
    public int RefreshDays { get; set; } = 30;
}

public sealed class PasswordHasher
{
    private const int Iterations = 210_000;
    private const int SaltSize = 16, KeySize = 32;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA512, KeySize);
        return $"v1.{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 4 || parts[0] != "v1" || !int.TryParse(parts[1], out var iter)) return false;
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iter, HashAlgorithmName.SHA512, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

public sealed class AuthService(AppDbContext db, PasswordHasher hasher, IOptions<JwtOptions> jwtOptions, TimeProvider clock)
{
    private readonly JwtOptions _jwt = jwtOptions.Value;
    private const int MaxFailures = 5;
    private static readonly TimeSpan LockoutSpan = TimeSpan.FromMinutes(10);

    public async Task<AuthResponse> RegisterAsync(RegisterRequest r, CancellationToken ct)
    {
        var email = r.Email.Trim();
        var norm = email.ToUpperInvariant();
        if (await db.Users.AnyAsync(u => u.NormalizedEmail == norm, ct))
            throw new DomainException("auth.email_taken", "Email is already registered.", 409);

        var user = new User
        {
            Email = email, NormalizedEmail = norm, PasswordHash = hasher.Hash(r.Password),
            DisplayName = r.DisplayName.Trim(), Locale = r.Locale is "uz" or "ru" or "en" ? r.Locale : "uz",
        };
        db.Users.Add(user);
        UserDefaults.AddProfile(db, user.Id, UserDefaults.MainProfileName);
        db.AuditLogs.Add(new AuditLog { UserId = user.Id, Action = "user.register", EntityType = "User", EntityId = user.Id });
        await db.SaveChangesAsync(ct);
        return await IssueAsync(user, Guid.NewGuid(), ct);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest r, string? ip, CancellationToken ct)
    {
        var norm = r.Email.Trim().ToUpperInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == norm, ct);
        var now = clock.GetUtcNow();
        if (user is null)
        {
            hasher.Hash(r.Password); // equalize timing
            throw new DomainException("auth.invalid_credentials", "Invalid email or password.", 401);
        }
        if (user.LockoutUntil is { } until && until > now)
            throw new DomainException("auth.locked", "Too many attempts. Try again later.", 429);

        if (!hasher.Verify(r.Password, user.PasswordHash))
        {
            user.FailedLoginCount++;
            if (user.FailedLoginCount >= MaxFailures)
            {
                user.LockoutUntil = now + LockoutSpan;
                user.FailedLoginCount = 0;
            }
            db.AuditLogs.Add(new AuditLog { UserId = user.Id, Action = "auth.login_failed", Ip = ip });
            await db.SaveChangesAsync(ct);
            throw new DomainException("auth.invalid_credentials", "Invalid email or password.", 401);
        }

        user.FailedLoginCount = 0;
        user.LockoutUntil = null;
        db.AuditLogs.Add(new AuditLog { UserId = user.Id, Action = "auth.login", Ip = ip });
        await db.SaveChangesAsync(ct);
        return await IssueAsync(user, Guid.NewGuid(), ct);
    }

    public async Task<AuthResponse> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        var hash = Hash(refreshToken);
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct)
                    ?? throw new DomainException("auth.invalid_refresh", "Invalid refresh token.", 401);
        var now = clock.GetUtcNow();

        if (token.UsedAt is not null || token.RevokedAt is not null)
        {
            // Replay of a rotated token => the family is compromised.
            await db.RefreshTokens.Where(t => t.FamilyId == token.FamilyId && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
            throw new DomainException("auth.refresh_reuse", "Refresh token was already used.", 401);
        }
        if (token.ExpiresAt <= now) throw new DomainException("auth.invalid_refresh", "Refresh token expired.", 401);

        var consumed = await db.RefreshTokens.Where(t => t.Id == token.Id && t.UsedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now), ct);
        if (consumed == 0) throw new DomainException("auth.refresh_reuse", "Refresh token was already used.", 401);

        var user = await db.Users.FirstAsync(u => u.Id == token.UserId, ct);
        return await IssueAsync(user, token.FamilyId, ct);
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct)
    {
        var hash = Hash(refreshToken);
        var token = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (token is null) return;
        var now = clock.GetUtcNow();
        await db.RefreshTokens.Where(t => t.FamilyId == token.FamilyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
    }

    private async Task<AuthResponse> IssueAsync(User user, Guid family, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var expires = now.AddMinutes(_jwt.AccessMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Secret));
        var jwt = new JwtSecurityToken(_jwt.Issuer, _jwt.Audience, claims, now.UtcDateTime, expires.UtcDateTime,
            new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        var access = new JwtSecurityTokenHandler().WriteToken(jwt);

        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id, FamilyId = family, TokenHash = Hash(raw), ExpiresAt = now.AddDays(_jwt.RefreshDays),
        });
        await db.SaveChangesAsync(ct);
        return new AuthResponse(access, raw, expires, ToDto(user));
    }

    public static UserDto ToDto(User u) => new(u.Id, u.Email, u.DisplayName, u.Locale, u.DefaultCurrency, u.Theme);

    private static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
