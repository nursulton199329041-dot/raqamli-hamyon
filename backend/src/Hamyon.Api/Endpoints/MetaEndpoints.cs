namespace Hamyon.Api.Endpoints;

public sealed record ClientPolicy(string MinVersion, string LatestVersion, int ApiVersion, string? Message);

/// <summary>
/// Anonymous compatibility contract for mobile clients: the minimum app version the API still supports,
/// the latest store version and the API contract version. Values come from configuration (Client:*),
/// so a release can raise MinVersion without redeploying code.
/// </summary>
public static class MetaEndpoints
{
    public const int ApiVersion = 1;

    public static void MapMeta(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/meta/client-policy", (IConfiguration cfg) =>
            Results.Ok(new ClientPolicy(
                cfg["Client:MinVersion"] ?? "1.0.0",
                cfg["Client:LatestVersion"] ?? "1.0.0",
                ApiVersion,
                cfg["Client:Message"])))
            .WithTags("Meta").AllowAnonymous();
    }
}
