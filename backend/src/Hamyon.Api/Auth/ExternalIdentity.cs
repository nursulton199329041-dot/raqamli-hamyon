using Hamyon.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Hamyon.Api.Auth;

/// <summary>An identity proven by an external OpenID Connect provider (Google today, Raqamli Passport later).</summary>
public sealed record ExternalIdentity(string Issuer, string Subject, string? Email, bool EmailVerified, string? Name);

/// <summary>Turns a provider's ID token into a verified identity. One implementation per provider.</summary>
public interface IExternalTokenValidator
{
    Task<ExternalIdentity> ValidateAsync(string idToken, CancellationToken ct);
}

public sealed class GoogleOptions
{
    /// <summary>OAuth client ids (Android, iOS, web) whose ID tokens are accepted. Empty = Google sign-in is off.</summary>
    public string[] ClientIds { get; set; } = [];
}

/// <summary>
/// Verifies a Google ID token: signature against Google's published keys, issuer, audience (one of our client ids) and
/// lifetime. Nothing from the token is trusted before this passes.
/// </summary>
public sealed class GoogleTokenValidator(IOptions<GoogleOptions> options) : IExternalTokenValidator
{
    public const string Issuer = "https://accounts.google.com";

    private static readonly ConfigurationManager<OpenIdConnectConfiguration> Discovery = new(
        $"{Issuer}/.well-known/openid-configuration", new OpenIdConnectConfigurationRetriever(),
        new HttpDocumentRetriever { RequireHttps = true });

    public async Task<ExternalIdentity> ValidateAsync(string idToken, CancellationToken ct)
    {
        var audiences = options.Value.ClientIds.Where(c => !string.IsNullOrWhiteSpace(c)).ToArray();
        if (audiences.Length == 0) throw new DomainException("auth.google_disabled", "Google sign-in is not configured.", 503);
        if (string.IsNullOrWhiteSpace(idToken) || idToken.Length > 8192)
            throw new DomainException("auth.google_invalid", "Google sign-in failed.", 401);

        var config = await Discovery.GetConfigurationAsync(ct);
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(idToken, new TokenValidationParameters
        {
            ValidIssuers = [Issuer, "accounts.google.com"],
            ValidAudiences = audiences,
            IssuerSigningKeys = config.SigningKeys,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2),
        });
        if (!result.IsValid) throw new DomainException("auth.google_invalid", "Google sign-in failed.", 401);

        var c = result.Claims;
        string? Str(string k) => c.TryGetValue(k, out var v) ? v?.ToString() : null;
        var sub = Str("sub");
        if (string.IsNullOrEmpty(sub)) throw new DomainException("auth.google_invalid", "Google sign-in failed.", 401);
        var verified = c.TryGetValue("email_verified", out var ev) && (ev is true || string.Equals(ev?.ToString(), "true", StringComparison.OrdinalIgnoreCase));
        return new ExternalIdentity(Issuer, sub, Str("email"), verified, Str("name"));
    }
}
