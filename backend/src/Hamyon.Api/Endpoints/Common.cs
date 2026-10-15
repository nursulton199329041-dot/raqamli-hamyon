using System.Security.Claims;
using FluentValidation;
using Hamyon.Api.Contracts;
using Hamyon.Domain;

namespace Hamyon.Api.Endpoints;

public static class Common
{
    public static Guid UserId(this ClaimsPrincipal user)
    {
        var sub = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
        return Guid.TryParse(sub, out var id) ? id : throw new DomainException("auth.unauthorized", "Unauthorized.", 401);
    }

    /// <summary>Runs the FluentValidation validator for <typeparamref name="T"/> before the handler.</summary>
    public static RouteHandlerBuilder Validate<T>(this RouteHandlerBuilder b) where T : class =>
        b.AddEndpointFilter(async (ctx, next) =>
        {
            var arg = ctx.Arguments.OfType<T>().FirstOrDefault();
            if (arg is null) return Results.BadRequest(new ErrorResponse("validation", "Request body is required."));
            var validator = ctx.HttpContext.RequestServices.GetService<IValidator<T>>();
            if (validator is not null)
            {
                var result = await validator.ValidateAsync(arg, ctx.HttpContext.RequestAborted);
                if (!result.IsValid)
                {
                    var fields = result.Errors.GroupBy(e => e.PropertyName)
                        .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());
                    return Results.Json(new ErrorResponse("validation", "Validation failed.", fields), statusCode: 400);
                }
            }
            return await next(ctx);
        });

    /// <summary>Client supplies Idempotency-Key header; it is used when the body has no ClientKey.</summary>
    public static string? HeaderKey(HttpContext ctx) =>
        ctx.Request.Headers.TryGetValue("Idempotency-Key", out var v) ? v.ToString() : null;
}
