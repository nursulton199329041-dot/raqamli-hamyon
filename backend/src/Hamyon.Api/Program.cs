using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using FluentValidation;
using Hamyon.Api.Auth;
using Hamyon.Api.Contracts;
using Hamyon.Api.Data;
using Hamyon.Api.Endpoints;
using Hamyon.Api.Ledger;
using Hamyon.Domain;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((ctx, lc) => lc.ReadFrom.Configuration(ctx.Configuration).WriteTo.Console());

// ---- configuration
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<GoogleOptions>(builder.Configuration.GetSection("Google"));
builder.Services.AddSingleton<IExternalTokenValidator, GoogleTokenValidator>();
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwt.Secret) || Encoding.UTF8.GetByteCount(jwt.Secret) < 32)
{
    if (!builder.Environment.IsDevelopment() && !builder.Environment.IsEnvironment("Testing"))
        throw new InvalidOperationException("Jwt:Secret (>= 32 bytes) must be provided via environment variable Jwt__Secret.");
    // Development only: ephemeral per-process key, never persisted.
    jwt.Secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
    builder.Services.Configure<JwtOptions>(o => o.Secret = jwt.Secret);
}

// ---- services
// Connection string is resolved lazily so host-level overrides (tests, env vars) are honoured.
builder.Services.AddDbContext<AppDbContext>((sp, o) => o
    .UseNpgsql(sp.GetRequiredService<IConfiguration>().GetConnectionString("Default")
               ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured."))
    // Migrations are authored from the model script (no model snapshot), so skip the snapshot drift check.
    .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddScoped<ProfileScope>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<ILedgerService, LedgerService>();
builder.Services.AddScoped<FinanceService>();
builder.Services.AddScoped<Hamyon.Api.Reports.AnalyticsService>();
builder.Services.AddScoped<Hamyon.Api.Reports.ExportService>();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();
builder.Services.AddOpenApi();
builder.Services.AddHttpContextAccessor();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = jwt.Issuer,
        ValidAudience = jwt.Audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Secret)),
        ValidateIssuerSigningKey = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = "sub",
    };
});
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = builder.Configuration.GetValue("RateLimit:AuthPerMinute", 20), Window = TimeSpan.FromMinutes(1) }));
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.User.FindFirst("sub")?.Value ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = builder.Configuration.GetValue("RateLimit:PerMinute", 600), Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
    // Content-Disposition carries the export file name (period + filters); browsers hide it from JS unless exposed.
    if (origins.Length > 0) p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Disposition");
}));

var app = builder.Build();

// ---- error handling: domain errors map to stable codes, internals are never leaked
app.UseExceptionHandler(errApp => errApp.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var logger = ctx.RequestServices.GetRequiredService<ILogger<Program>>();
    ErrorResponse body;
    int status;
    switch (ex)
    {
        case DomainException de:
            status = de.Status;
            body = new ErrorResponse(de.Code, de.Message);
            break;
        case DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } }:
            status = 409;
            body = new ErrorResponse("conflict", "Concurrent update, please retry.");
            break;
        case BadHttpRequestException:
            status = 400;
            body = new ErrorResponse("bad_request", "Malformed request.");
            break;
        default:
            logger.LogError(ex, "Unhandled exception");
            status = 500;
            body = new ErrorResponse("server_error", "Unexpected error.");
            break;
    }
    ctx.Response.StatusCode = status;
    await ctx.Response.WriteAsJsonAsync(body);
}));

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["X-Frame-Options"] = "DENY";
    ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
    await next();
});

if (!app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("Testing"))
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseProfileScope();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(o => o.SwaggerEndpoint("/openapi/v1.json", "Raqamli Hamyon API v1"));
}

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapAuth();
app.MapProfiles();
app.MapCatalogs();
app.MapOperations();
app.MapReports();
app.MapMeta();
app.MapSync();
app.MapAttachments();

if (args.Contains("--print-schema"))
{
    // Dev tool: emits the CREATE script for the current model (used to author migrations without dotnet-ef).
    using var scope = app.Services.CreateScope();
    Console.WriteLine(scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.GenerateCreateScript());
    return;
}

if (app.Configuration.GetValue("Database:AutoMigrate", false))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

// Demo data: only in Development and only when explicitly enabled (Demo__Seed=true).
if (app.Environment.IsDevelopment() && app.Configuration.GetValue("Demo:Seed", false))
{
    await Hamyon.Api.Data.DemoSeeder.SeedAsync(app.Services, app.Configuration["Demo:Password"] ?? "Demo12345!");
    app.Logger.LogInformation("Demo account ready: {Email}", Hamyon.Api.Data.DemoSeeder.DemoEmail);
}

await app.RunAsync();

public partial class Program;
