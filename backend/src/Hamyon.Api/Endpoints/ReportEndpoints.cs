using Hamyon.Api.Reports;
using Hamyon.Domain;

namespace Hamyon.Api.Endpoints;

public static class ReportEndpoints
{
    public static void MapReports(this IEndpointRouteBuilder app)
    {
        var a = app.MapGroup("/api/analytics").WithTags("Analytics").RequireAuthorization();

        a.MapGet("/summary", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q, CancellationToken ct) =>
            Results.Ok(await svc.SummaryAsync(ctx.User.UserId(), q, ct)));

        a.MapGet("/timeseries", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q,
            string? granularity, CancellationToken ct) =>
        {
            var g = granularity is "day" or "week" or "month" or "year" ? granularity : "day";
            return Results.Ok(await svc.TimeSeriesAsync(ctx.User.UserId(), q, g, ct));
        });

        a.MapGet("/breakdown", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q,
            string? by, CancellationToken ct) =>
        {
            var key = by is "wallet" or "project" or "person" or "source" ? by : "category";
            return Results.Ok(await svc.BreakdownAsync(ctx.User.UserId(), q, key, ct));
        });

        a.MapGet("/budgets", async (HttpContext ctx, AnalyticsService svc, CancellationToken ct) =>
            Results.Ok(await svc.BudgetsAsync(ctx.User.UserId(), DateTimeOffset.UtcNow, ct)));

        a.MapGet("/balance", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q,
            string? granularity, CancellationToken ct) =>
        {
            var g = granularity is "day" or "week" or "month" or "year" ? granularity : "day";
            return Results.Ok(await svc.BalanceAsync(ctx.User.UserId(), q, g, ct));
        });

        a.MapGet("/wallets", async (HttpContext ctx, AnalyticsService svc, [AsParameters] TransactionQuery q, CancellationToken ct) =>
            Results.Ok(await svc.WalletPeriodsAsync(ctx.User.UserId(), q, ct)));

        app.MapGet("/api/reports/export", async (HttpContext ctx, ExportService export, [AsParameters] TransactionQuery q,
            string? format, string? lang, string? granularity, CancellationToken ct) =>
        {
            var fmt = (format ?? "csv").ToLowerInvariant();
            if (fmt is not ("xlsx" or "pdf" or "csv")) throw new DomainException("export.format", "Format must be csv, xlsx or pdf.");
            var table = await export.BuildAsync(ctx.User.UserId(), q, lang ?? "uz", granularity, ct);
            var name = $"{table.FileStem}.{fmt}";
            return fmt switch
            {
                "xlsx" => Results.File(ExportService.ToXlsx(table), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name),
                "pdf" => Results.File(PdfReport.Build(table), "application/pdf", name),
                _ => Results.File(ExportService.ToCsv(table), "text/csv; charset=utf-8", name),
            };
        }).WithTags("Reports").RequireAuthorization();
    }
}
